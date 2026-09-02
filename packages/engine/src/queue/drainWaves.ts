import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { LeftBehindTicket } from '#src/queue/common/types/LeftBehindTicket.ts';
import type { ParkedWork } from '#src/queue/common/types/ParkedWork.ts';
import type { QueueDrainReport } from '#src/queue/common/types/QueueDrainReport.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import type { WaveSelection } from '#src/queue/common/types/WaveSelection.ts';
import { getWorktreesRoot } from '#src/queue/common/utils/getWorktreesRoot.ts';
import { listNextWave } from '#src/queue/listNextWave.ts';
import { runQueueWave } from '#src/queue/runQueueWave.ts';
import { toTicketBranch } from '#src/queue/toTicketBranch.ts';
import type { ShipSettings } from '#src/ship/index.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	cwd: string;
	settings: QueueSettings;
	trackerSettings: TrackerSettings;
	shipSettings: ShipSettings;
	config: LightsoutConfig;
	defaultBranch: string;
	/** Where the coordinator run's `queue.md` is written. */
	planPath: string;
	/** The first wave's selection, built from the parked scan and the opening tracker read. */
	first: WaveSelection;
	parked: ParkedWork;
	runTicket: (params: { ticket: TicketSummary }) => Promise<TicketRunOutcome>;
	onProgress?: (message: string) => void;
}

/** The coordinator run's document: one line per ticket, naming the route, the branch and the worktree a human can reach it in. */
const writeQueuePlan = ({ path, queued, settings, cwd }: { path: string; queued: TicketSummary[]; settings: QueueSettings; cwd: string }) => {
	const root = getWorktreesRoot({ cwd });
	const lines = queued.map((ticket) => {
		const branch = toTicketBranch({ ticket, template: settings.branchTemplate });

		return `- ${ticket.identifier} · ${ticket.route} · ${branch} · ${join(root, branch)}`;
	});

	return writeFile(path, `# queue drain\n\n${lines.join('\n')}\n`, 'utf8');
};

/** The identifiers the parked scan already settled — attempted before the first wave even starts. */
const toParkedIdentifiers = ({ parked }: { parked: ParkedWork }) => [
	...parked.outcomes.map((outcome) => outcome.ticket.identifier),
	...parked.leftBehind.map((entry) => entry.identifier),
];

/** Remember a scan's held-back tickets, so one stays reportable even after later scans stop returning it. */
const rememberBlocked = ({ blockedByIdentifier, entries }: { blockedByIdentifier: Map<string, LeftBehindTicket>; entries: LeftBehindTicket[] }) => {
	for (const entry of entries) {
		blockedByIdentifier.set(entry.identifier.toLowerCase(), entry);
	}
};

/** Every identifier a wave is done with: never offered to another one, and no longer waiting on a blocker. */
const settleWave = ({
	attempted,
	blockedByIdentifier,
	selection,
	wave,
}: {
	attempted: Set<string>;
	blockedByIdentifier: Map<string, LeftBehindTicket>;
	selection: WaveSelection;
	wave: QueueDrainReport;
}) => {
	const identifiers = [
		...selection.runnable.map((ticket) => ticket.identifier),
		...selection.skipped.map((entry) => entry.identifier),
		...wave.leftBehind.map((entry) => entry.identifier),
	];

	for (const identifier of identifiers) {
		attempted.add(identifier.toLowerCase());
		blockedByIdentifier.delete(identifier.toLowerCase());
	}
};

/**
 * Wave after wave until a scan finds nothing newly runnable.
 *
 * Only tickets held back as blocked stay candidates: every identifier a wave was
 * offered is recorded as attempted and never offered again, whatever became of
 * it. That is what makes the loop terminate, and it is why a parked ticket is
 * never re-resumed inside one invocation to re-ask the same question.
 *
 * The report is the FINAL state, not a log of every wave: a ticket blocked in an
 * early wave that ran in a later one appears only as an outcome, and a ticket
 * still blocked at the end appears exactly once in `leftBehind`.
 */
export const drainWaves = async ({
	cwd,
	settings,
	trackerSettings,
	shipSettings,
	config,
	defaultBranch,
	planPath,
	first,
	parked,
	runTicket,
	onProgress,
}: Params): Promise<QueueDrainReport> => {
	const outcomes: TicketRunOutcome[] = [];
	const leftBehind: LeftBehindTicket[] = [...parked.leftBehind];
	const attempted = new Set<string>(toParkedIdentifiers({ parked }).map((identifier) => identifier.toLowerCase()));
	// Every ticket ever held back as blocked, keyed by lower-cased identifier.
	// A later scan cannot return a resumed ticket (its status is in-progress, and
	// the eligible query filters on status), so the report must not depend on the
	// ticket staying visible: an entry leaves this map only by becoming an
	// outcome or a skip, and whatever remains at the end is left behind exactly
	// once — a ticket must never vanish from the summary.
	const blockedByIdentifier = new Map<string, LeftBehindTicket>();
	const queuedSoFar: TicketSummary[] = [];
	let selection = first;
	let carried = parked.outcomes;

	for (;;) {
		queuedSoFar.push(...selection.runnable);
		rememberBlocked({ blockedByIdentifier, entries: selection.blocked });

		await writeQueuePlan({ path: planPath, queued: queuedSoFar, settings, cwd });

		const wave = await runQueueWave({
			cwd,
			config,
			shipSettings,
			defaultBranch,
			queued: selection.runnable,
			maxParallel: settings.maxParallel,
			carried,
			runTicket,
			onProgress,
		});

		outcomes.push(...wave.outcomes);
		leftBehind.push(...selection.skipped, ...wave.leftBehind);
		settleWave({ attempted, blockedByIdentifier, selection, wave });

		// The parked scan's outcomes are settled once: carrying them into a second
		// wave would ship or report them twice.
		carried = [];

		if (selection.blocked.length === 0) {
			break;
		}

		const next = await listNextWave({ settings, trackerSettings, attempted, onProgress });

		if ('error' in next) {
			onProgress?.(`the re-scan for newly unblocked tickets failed, so the drain stops here: ${next.error}`);
			break;
		}

		if (next.runnable.length === 0) {
			rememberBlocked({ blockedByIdentifier, entries: next.blocked });
			leftBehind.push(...next.skipped);
			break;
		}

		selection = next;
	}

	leftBehind.push(...blockedByIdentifier.values());

	const report: QueueDrainReport = { outcomes, leftBehind };

	return report;
};
