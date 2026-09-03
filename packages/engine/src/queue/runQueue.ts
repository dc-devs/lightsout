import { join } from 'node:path';
import { type LightsoutConfig, PipelineKind, RunStatus } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { checkQueueStartup } from '#src/queue/checkQueueStartup.ts';
import type { ParkedWork } from '#src/queue/common/types/ParkedWork.ts';
import type { QuestionRelay } from '#src/queue/common/types/QuestionRelay.ts';
import type { QueueDrainReport } from '#src/queue/common/types/QueueDrainReport.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { WaveSelection } from '#src/queue/common/types/WaveSelection.ts';
import { drainWaves } from '#src/queue/drainWaves.ts';
import { listEligibleTickets } from '#src/queue/listEligibleTickets.ts';
import { orderTickets } from '#src/queue/orderTickets.ts';
import { runQueueTicket } from '#src/queue/runQueueTicket.ts';
import { scanParkedWorktrees } from '#src/queue/scanParkedWorktrees.ts';
import { selectWaveTickets } from '#src/queue/selectWaveTickets.ts';
import { settleParkedLabels } from '#src/queue/settleParkedLabels.ts';
import { createRun, getRunDir, seedUsageTotals, withRunLock, writeManifestWithUsage } from '#src/runState/index.ts';
import type { ShipSettings } from '#src/ship/index.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	cwd: string;
	settings: QueueSettings;
	trackerSettings: TrackerSettings;
	shipSettings: ShipSettings;
	config: LightsoutConfig;
	/** The process environment the tracker credentials are read from. Passed rather than read, so a test never needs to mutate `process.env`. */
	env: NodeJS.ProcessEnv;
	driver: Driver;
	driverName: string;
	relay: QuestionRelay;
	onProgress?: (message: string) => void;
}

/** One promise tail every `git worktree add` awaits and replaces — creation mutates the main checkout, so two of them must never overlap. */
const createWorktreeSerializer = () => {
	let tail: Promise<unknown> = Promise.resolve();

	return <Result>({ task }: { task: () => Promise<Result> }): Promise<Result> => {
		const next = tail.then(task, task);

		tail = next.catch(() => undefined);

		return next;
	};
};

/** The locked half of a drain: the coordinator run, the waves, then the settled labels. */
const drainAndShip = async ({
	cwd,
	runId,
	settings,
	trackerSettings,
	shipSettings,
	config,
	env,
	driver,
	driverName,
	relay,
	defaultBranch,
	first,
	parked,
	onProgress,
}: Params & { runId: string; defaultBranch: string; first: WaveSelection; parked: ParkedWork }) => {
	const coordinatorRunDir = getRunDir({ cwd, runId });
	const planPath = join(coordinatorRunDir, 'queue.md');
	const manifest = await createRun({ cwd, runId, plan: planPath, pipeline: PipelineKind.Queue, driver: driverName, config });

	await writeManifestWithUsage({ cwd, manifest, patch: { status: RunStatus.Running }, usageTotals: seedUsageTotals({ usage: manifest.usage }) });

	const serializeWorktreeAdd = createWorktreeSerializer();
	const drained = await drainWaves({
		cwd,
		settings,
		trackerSettings,
		shipSettings,
		config,
		env,
		defaultBranch,
		planPath,
		first,
		parked,
		onProgress,
		runTicket: ({ ticket }) =>
			runQueueTicket({
				cwd,
				settings,
				trackerSettings,
				ticket,
				config,
				driver,
				driverName,
				defaultBranch,
				relay,
				serializeWorktreeAdd,
				coordinatorRunId: runId,
				coordinatorRunDir,
				onProgress: relay.createProgressSink({ ticket }),
			}),
	});
	// A reconciled already-merged ticket is `settled` and never re-offered, so it
	// is not work left: counting it would record an escalated coordinator run for
	// a drain in which everything eligible shipped.
	const unfinished = drained.leftBehind.filter((entry) => entry.settled !== true);
	const status = drained.outcomes.every((outcome) => outcome.ready) && unfinished.length === 0 ? RunStatus.Passed : RunStatus.Escalated;

	// One call is the whole park/ship label story: shipping has already flipped
	// `ready` on anything it could not merge, so a ship-step park is labelled by
	// the same line that labels a worker park.
	await settleParkedLabels({ settings, trackerSettings, outcomes: drained.outcomes, onProgress });
	await writeManifestWithUsage({ cwd, manifest, patch: { status, currentStep: null }, usageTotals: seedUsageTotals({ usage: manifest.usage }) });

	return drained;
};

/**
 * The supervisor: read the tracker, drain what it finds into parallel
 * worktrees, then merge the ready branches one at a time — and exit.
 *
 * Parked runs come first, because a restart is the resume path: their tickets
 * sit at the in-progress status where the eligible query cannot see them, so
 * they are found on disk instead. Steps from the coordinator run onward hold
 * the repo's run lock, which is what makes two concurrent `lightsout queue`
 * invocations impossible; each worker takes its own lock in its own worktree,
 * so the two never contend.
 *
 * The drain runs in waves — everything unblocked, ship, re-scan — and stops when
 * a scan finds nothing newly runnable. The run lock and the coordinator run are
 * still one per invocation, and the parked worktree scan still runs only before
 * the first wave.
 */
export const runQueue = async ({
	cwd,
	settings,
	trackerSettings,
	shipSettings,
	config,
	env,
	driver,
	driverName,
	relay,
	onProgress,
}: Params): Promise<QueueDrainReport | QueueFailure> => {
	const started = await checkQueueStartup({ cwd, settings, trackerSettings, shipSettings });

	if ('error' in started) {
		return started;
	}

	const { defaultBranch } = started;
	const eligible = await listEligibleTickets({ settings, trackerSettings });

	if ('error' in eligible) {
		return eligible;
	}

	const parked = await scanParkedWorktrees({ cwd, defaultBranch, settings, trackerSettings, shipSettings, onProgress });

	if ('error' in parked) {
		return parked;
	}

	const first = selectWaveTickets({ tickets: [...parked.resumed, ...orderTickets({ tickets: eligible })], settings, attempted: new Set<string>(), onProgress });

	if (first.runnable.length === 0 && parked.outcomes.length === 0 && parked.merged.length === 0) {
		onProgress?.(
			first.blocked.length > 0
				? 'nothing to do — every eligible ticket is waiting on an unfinished blocker'
				: 'nothing to do — no eligible tickets, and no parked worktrees to pick up',
		);

		const empty: QueueDrainReport = { outcomes: [], leftBehind: [...parked.leftBehind, ...first.skipped, ...first.blocked] };

		return empty;
	}

	return withRunLock({
		params: { cwd, onProgress },
		run: ({ runId }) =>
			drainAndShip({ cwd, runId, settings, trackerSettings, shipSettings, config, env, driver, driverName, relay, defaultBranch, first, parked, onProgress }),
	});
};
