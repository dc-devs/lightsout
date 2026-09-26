import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import type { GateHolds } from '#src/gates/gateHolds/common/types/GateHolds.ts';
import { syncGateHolds } from '#src/gates/gateHolds/syncGateHolds.ts';
import { BoardQuestionRelay } from '#src/queue/board/BoardQuestionRelay.ts';
import { QueueBoardRecorder } from '#src/queue/board/QueueBoardRecorder.ts';
import type { QuestionRelay } from '#src/queue/common/types/QuestionRelay.ts';
import type { QueueDrainReport } from '#src/queue/common/types/QueueDrainReport.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import { isParkedOutcome } from '#src/queue/common/utils/isParkedOutcome.ts';
import type { ParkedWork } from '#src/queue/internal/common/types/ParkedWork.ts';
import type { WaveSelection } from '#src/queue/internal/common/types/WaveSelection.ts';
import { createMainCheckoutSerializer } from '#src/queue/internal/common/utils/createMainCheckoutSerializer.ts';
import { startCoordinatorRun } from '#src/queue/internal/common/utils/startCoordinatorRun.ts';
import { drainQueue } from '#src/queue/internal/drainQueue.ts';
import { runQueueWorkOrder } from '#src/queue/internal/runQueueWorkOrder.ts';
import { settleParkedLabels } from '#src/queue/internal/settleParkedLabels.ts';
import { checkQueueStartup } from '#src/queue/startup/checkQueueStartup.ts';
import { listEligibleTickets } from '#src/queue/ticketSelection/listEligibleTickets.ts';
import { orderTickets } from '#src/queue/ticketSelection/orderTickets.ts';
import { selectWaveTickets } from '#src/queue/ticketSelection/selectWaveTickets.ts';
import { scanParkedWorktrees } from '#src/queue/worktrees/scanParkedWorktrees.ts';
import { withRunLock } from '#src/runState/lock/withRunLock.ts';
import { seedUsageTotals } from '#src/runState/seedUsageTotals.ts';
import { writeManifestWithUsage } from '#src/runState/writeManifestWithUsage.ts';
import type { ShipSettings } from '#src/ship/common/types/ShipSettings.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';

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

/**
 * Passed when everything the drain ran shipped and nothing is left waiting on a re-run.
 *
 * A reconciled already-merged ticket is `settled` and never re-offered, so it
 * is not work left: counting it would record an escalated coordinator run for
 * a drain in which everything eligible shipped. A ticket the queue left open is
 * not work left either — it waits on a human decision, and the exit code says
 * the same, which is why both read the one parked rule.
 */
const toCoordinatorStatus = ({ drained }: { drained: QueueDrainReport }) => {
	const unfinished = drained.leftBehind.filter((entry) => entry.settled !== true);
	const parked = drained.outcomes.filter((outcome) => isParkedOutcome({ outcome }));

	return parked.length === 0 && unfinished.length === 0 ? RunStatus.Passed : RunStatus.Escalated;
};

/** The locked half of a drain: the coordinator run, the two lanes, then the settled labels. */
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
	holds,
	onProgress,
}: Params & { runId: string; defaultBranch: string; first: WaveSelection; parked: ParkedWork; holds: GateHolds }) => {
	const { coordinatorRunDir, planPath, manifest } = await startCoordinatorRun({ cwd, runId, driverName, config });

	// One chain per drain, threaded to everything that mutates the main checkout:
	// the builders' `git worktree add`, the merge tail's removal and the re-scan's.
	const serializeMainCheckout = createMainCheckoutSerializer();
	const board = new QueueBoardRecorder({ cwd, runId, onProgress });
	// Workers ask through this, so an open question shows on the board; delivery stays the CLI relay's.
	const boardRelay = new BoardQuestionRelay({ relay, board });
	const drained = await drainQueue({
		cwd,
		runId,
		holds,
		settings,
		trackerSettings,
		shipSettings,
		// Built here from what the drain already holds: `config` is the effective
		// config and `driver` the resolved harness, so the merge lane's integration
		// step recovers with exactly what the builders were given.
		shipIntegration: { config, driver },
		// The same harness the builders get, threaded so the wave's naming step
		// summarises a ticket's title exactly as `work-order new` does.
		driver,
		config,
		env,
		defaultBranch,
		planPath,
		first,
		parked,
		serializeMainCheckout,
		board,
		onProgress,
		runWorkOrder: ({ workOrder }) =>
			runQueueWorkOrder({
				cwd,
				settings,
				trackerSettings,
				workOrder,
				config,
				driver,
				driverName,
				defaultBranch,
				env,
				relay: boardRelay,
				serializeWorktreeAdd: serializeMainCheckout,
				coordinatorRunId: runId,
				coordinatorRunDir,
				onProgress: relay.createProgressSink({ ticket: workOrder.ticket }),
			}),
	});
	const status = toCoordinatorStatus({ drained });

	// One call is the whole park/ship label story: shipping has already flipped
	// `ready` on anything it could not merge, so a ship-step park is labelled by
	// the same line that labels a worker park.
	await settleParkedLabels({ settings, trackerSettings, outcomes: drained.outcomes, onProgress });
	// The last board write lands before the run records its final status.
	await board.flush();
	await writeManifestWithUsage({ cwd, manifest, patch: { status, currentStep: null }, usageTotals: seedUsageTotals({ usage: manifest.usage }) });

	return drained;
};

/**
 * The supervisor: read the tracker, drain what it finds into parallel
 * worktrees, and merge each branch the moment it is ready — then exit.
 *
 * Parked runs come first, because a restart is the resume path: their tickets
 * sit at the in-progress status where the eligible query cannot see them, so
 * they are found on disk instead. Steps from the coordinator run onward hold
 * the repo's run lock, which is what makes two concurrent `lightsout queue`
 * invocations impossible; each worker takes its own lock in its own worktree,
 * so the two never contend.
 *
 * Building and merging run at the same time: parallel builders fill the slot
 * pool while one serial ship lane merges each branch as soon as it is ready, and
 * every landed merge re-reads the tracker so the tickets it unblocked join the
 * run already in flight. The drain ends when both loops are idle and nothing is
 * left to build or to merge. The run lock and the coordinator run are still one
 * per invocation, and the parked worktree scan still runs only at the start.
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

	// Once per drain, and before the parked scan: the scan is the first site that
	// would otherwise clear a held ticket's parked label. A hold taken while this
	// drain runs belongs to a ticket already attempted and never re-offered, so a
	// snapshot misses nothing this drain could act on.
	const holds = await syncGateHolds({ cwd, settings: trackerSettings, onProgress });
	const parked = await scanParkedWorktrees({ cwd, defaultBranch, settings, trackerSettings, holds, onProgress });

	if ('error' in parked) {
		return parked;
	}

	const first = selectWaveTickets({
		tickets: [...parked.resumed, ...orderTickets({ tickets: eligible })],
		settings,
		attempted: new Set<string>(),
		holds,
		onProgress,
	});

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
			drainAndShip({
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
				holds,
				onProgress,
			}),
	});
};
