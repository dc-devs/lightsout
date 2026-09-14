import { describe, expect, jest, test } from '@jest/globals';
import { queueCommand } from '#src/cli/queueCommand.ts';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import type { QueueDrainReport, QueueFailure, QueueSettings, TicketRunOutcome } from '#src/queue/index.ts';
import type { TrackerFailure, TrackerSettings } from '#src/ticketTracker/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

/**
 * The summary a finished drain prints — the board, one line per ticket, and the
 * code the command exits on.
 *
 * A sibling of `queueCommand.unit.test.ts` rather than more cases in it: that
 * file states the config the command refuses and the terminal it opens and
 * closes, while every case here hands it a finished report and reads what came
 * out.
 */

// Mocked Imports
// -------------------------
// The drain spawns harnesses and talks to a tracker — the queue module's entry
// point, covered by its own tests. What a report amounts to on screen is
// observable with the drain stubbed.
type RunQueueParams = Parameters<typeof import('#src/queue/index.ts').runQueue>[0];
const mockResolveQueueSettings = jest.fn<() => QueueSettings | QueueFailure>();
const mockResolveTrackerSettings = jest.fn<() => TrackerSettings | TrackerFailure>();
const mockRunQueue = jest.fn<(params: RunQueueParams) => Promise<QueueDrainReport | QueueFailure>>();
const mockRelayClosed = jest.fn<() => void>();
const mockEmptyRelayMailbox = jest.fn<(params: { directory: string }) => Promise<void>>();

jest.mock('#src/queue/index.ts', () => {
	// Declared inside the factory rather than beside the mocks above it: the
	// factory runs before this module's own `const` bindings are initialised, so
	// anything it *calls* has to be in scope at that moment.
	const recordingRelay = () =>
		class {
			close() {
				mockRelayClosed();
			}
		};

	return {
		resolveQueueSettings: () => mockResolveQueueSettings(),
		runQueue: (params: RunQueueParams) => mockRunQueue(params),
		emptyRelayMailbox: (params: { directory: string }) => mockEmptyRelayMailbox(params),
		TerminalQuestionRelay: recordingRelay(),
		FileQuestionRelay: recordingRelay(),
		// Real, because the final board must be fed from the real projection of the
		// report, and the exit code must read the real rule for which outcomes parked.
		toQueueBoardTickets: jest.requireActual<typeof import('#src/queue/index.ts')>('#src/queue/index.ts').toQueueBoardTickets,
		isParkedOutcome: jest.requireActual<typeof import('#src/queue/index.ts')>('#src/queue/index.ts').isParkedOutcome,
	};
});
jest.mock('#src/ticketTracker/index.ts', () => ({ resolveTrackerSettings: () => mockResolveTrackerSettings() }));
// -------------------------

const settings = queueSettingsFixture();
const trackerSettings = trackerSettingsFixture();

/** One drain outcome for one ticket. `reconciliationFailure` rides beside a shipped one, never instead of it. */
const outcomeOf = ({ ready, error, reconciliationFailure }: { ready: boolean; error?: string; reconciliationFailure?: string }): TicketRunOutcome => ({
	ticket: {
		id: 'id-70',
		identifier: 'LO-70',
		title: 'Drain the backlog',
		url: 'https://linear.app/lightsout/issue/LO-70',
		description: '',
		priority: 2,
		createdAt: '2026-01-01T00:00:00.000Z',
		labels: [],
		planningStatus: PlanningStatus.NotNeeded,
		status: 'Ready to implement',
		finished: false,
		unfinishedBlockers: [],
	},
	branch: 'lo-70-drain',
	worktreePath: '/tmp/worktrees/lo-70-drain',
	ready,
	error,
	reconciliationFailure,
});

/** A ticket that merged, whose done write then failed — shipped and reported, with only the tracker left stale. */
const staleTrackerReport: QueueDrainReport = {
	outcomes: [outcomeOf({ ready: true, reconciliationFailure: 'LO-70 shipped, but its tracker status could not be moved to done' })],
	leftBehind: [],
};

/** An already-merged ticket the drain reconciled to done: reported in the summary, with nothing waiting on a re-run. */
const settledEntry = { identifier: 'LO-72', reason: 'skipped: its branch already has a merged pull request #9', settled: true };

/** A repo whose config carries a ship block, with the drain stubbed to hand back this report. */
const setupQueueCommand = ({ report }: { report: QueueDrainReport | QueueFailure }) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ config: { ship: { 'ticket-pattern': '^(?<ticket>[a-z]+-\\d+)' } } });

	mockResolveQueueSettings.mockReturnValue(settings);
	mockResolveTrackerSettings.mockReturnValue(trackerSettings);
	mockRunQueue.mockResolvedValue(report);
	mockEmptyRelayMailbox.mockResolvedValue(undefined);

	return { context: { flags: new Map<string, string | true>(), rest: [], cwd }, cwd, ...captured };
};

/** Another ticket's outcome under its own identifier, because the board gives each identifier exactly one cell. */
const otherOutcomeOf = ({ identifier, title, branch, error }: { identifier: string; title: string; branch: string; error: string }): TicketRunOutcome => {
	const base = outcomeOf({ ready: false, error });

	return {
		...base,
		ticket: { ...base.ticket, id: `id-${identifier}`, identifier, title, url: `https://linear.app/lightsout/issue/${identifier}` },
		branch,
		worktreePath: `/tmp/worktrees/${branch}`,
	};
};

/** A ticket the drain built as far as it could and then left open: not ready, carrying a reason and no error. */
const openOutcomeOf = ({ identifier, title, branch, open }: { identifier: string; title: string; branch: string; open: string }): TicketRunOutcome => {
	const base = outcomeOf({ ready: false });

	return {
		...base,
		ticket: { ...base.ticket, id: `id-${identifier}`, identifier, title, url: `https://linear.app/lightsout/issue/${identifier}` },
		branch,
		worktreePath: `/tmp/worktrees/${branch}`,
		open,
	};
};

/** The final board's heading: the finish time is the moment the command ran, so only its shape is pinned. */
const finishedHeading = expect.stringMatching(/^Queue finished · \d{2}:\d{2}$/);
const boardHeaderRow = '| Build Queue | Building | Ship Queue | Shipping Now | Shipped | Parked | Blocked |';
const boardSeparatorRow = '| --- | --- | --- | --- | --- | --- | --- |';

describe('queueCommand', () => {
	test('a drain where everything shipped names each ticket and exits 0', async () => {
		const { context, logged, exitCodes } = setupQueueCommand({ report: { outcomes: [outcomeOf({ ready: true })], leftBehind: [] } });

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain('LO-70 lo-70-drain shipped');
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a shipped ticket whose tracker could not be moved to done says so under its shipped line', async () => {
		const { context, logged } = setupQueueCommand({ report: staleTrackerReport });

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		// The final board comes first and ends in one blank line; the report, which holds none, is what follows it.
		const report = logged.slice(logged.lastIndexOf('') + 1);

		expect(report).toStrictEqual(['LO-70 lo-70-drain shipped', '  LO-70 shipped, but its tracker status could not be moved to done']);
	});

	test('a stale tracker keeps the drain at 0, because the branch is merged and a re-run has nothing to pick up', async () => {
		const { context, exitCodes } = setupQueueCommand({ report: staleTrackerReport });

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		expect(exitCodes).toStrictEqual([0]);
	});

	test('a parked ticket says why and where its worktree is, and exits 2 — work remains, and a re-run picks it up', async () => {
		const { context, logged, exitCodes } = setupQueueCommand({
			report: { outcomes: [outcomeOf({ ready: false, error: 'tsc: 3 errors' })], leftBehind: [] },
		});

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain('LO-70 lo-70-drain parked: tsc: 3 errors');
		expect(logged).toContain('  worktree: /tmp/worktrees/lo-70-drain');
		expect(exitCodes).toStrictEqual([2]);
	});

	test('a parked ticket with nothing recorded against it still says so, rather than printing a bare line', async () => {
		const { context, logged, exitCodes } = setupQueueCommand({ report: { outcomes: [outcomeOf({ ready: false })], leftBehind: [] } });

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain('LO-70 lo-70-drain parked: no reason recorded');
		expect(exitCodes).toStrictEqual([2]);
	});

	test('a ticket the drain deliberately never ran is still printed, so nothing vanishes from the summary', async () => {
		const { context, logged, exitCodes } = setupQueueCommand({
			report: { outcomes: [], leftBehind: [{ identifier: 'LO-71', reason: 'skipped: it carries the planning status labels' }] },
		});

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain('LO-71 skipped: it carries the planning status labels');
		expect(exitCodes).toStrictEqual([2]);
	});

	test('a settled ticket is still printed but exits 0, because a re-run has nothing to pick up for it', async () => {
		const { context, logged, exitCodes } = setupQueueCommand({ report: { outcomes: [outcomeOf({ ready: true })], leftBehind: [settledEntry] } });

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain('LO-72 skipped: its branch already has a merged pull request #9');
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a settled ticket beside an unfinished one still exits 2, because the unfinished one is waiting', async () => {
		const { context, exitCodes } = setupQueueCommand({
			report: { outcomes: [], leftBehind: [settledEntry, { identifier: 'LO-73', reason: 'skipped: it is blocked by an unfinished ticket' }] },
		});

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		expect(exitCodes).toStrictEqual([2]);
	});

	test('prints the final board, headed as finished, before the per-ticket report', async () => {
		const { context, logged } = setupQueueCommand({
			report: {
				outcomes: [
					outcomeOf({ ready: true }),
					otherOutcomeOf({ identifier: 'LO-74', title: 'Fix the import', branch: 'lo-74-import', error: 'tsc: 3 errors' }),
				],
				leftBehind: [{ identifier: 'LO-71', reason: 'skipped: it is blocked by an unfinished ticket' }],
			},
		});

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toEqual([
			finishedHeading,
			'',
			boardHeaderRow,
			boardSeparatorRow,
			'| — | — | — | — | [LO-70 · Drain the backlog](https://linear.app/lightsout/issue/LO-70) | [LO-74 · Fix the import](https://linear.app/lightsout/issue/LO-74) — tsc: 3 errors | LO-71 — skipped: it is blocked by an unfinished ticket |',
			'',
			'LO-70 lo-70-drain shipped',
			'LO-74 lo-74-import parked: tsc: 3 errors',
			'  worktree: /tmp/worktrees/lo-74-import',
			'LO-71 skipped: it is blocked by an unfinished ticket',
		]);
	});

	test('prints the final board even when the drain found nothing to do', async () => {
		const { context, logged, exitCodes } = setupQueueCommand({ report: { outcomes: [], leftBehind: [] } });

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toEqual([finishedHeading, '', boardHeaderRow, boardSeparatorRow, '| — | — | — | — | — | — | — |', '']);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('prints no board when the drain refused', async () => {
		const { context, logged, exitCodes } = setupQueueCommand({ report: { error: 'authentication failed' } });

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('clips a long parked reason on the board while the report line keeps the full text', async () => {
		const longError = 'x'.repeat(300);
		const { context, logged } = setupQueueCommand({ report: { outcomes: [outcomeOf({ ready: false, error: longError })], leftBehind: [] } });

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toEqual([
			finishedHeading,
			'',
			boardHeaderRow,
			boardSeparatorRow,
			`| — | — | — | — | — | [LO-70 · Drain the backlog](https://linear.app/lightsout/issue/LO-70) — ${'x'.repeat(119)}… | — |`,
			'',
			`LO-70 lo-70-drain parked: ${longError}`,
			'  worktree: /tmp/worktrees/lo-70-drain',
		]);
	});

	test('queueCommand: a ticket left open says why and exits 0', async () => {
		const { context, logged, exitCodes } = setupQueueCommand({
			report: {
				outcomes: [
					outcomeOf({ ready: true }),
					openOutcomeOf({
						identifier: 'LO-74',
						title: 'Support multiple plans',
						branch: 'lo-74-multiple-plans',
						open: 'no ship request names this ticket yet',
					}),
				],
				leftBehind: [],
			},
		});

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		const openLine = logged.find((line) => line.startsWith('LO-74 lo-74-multiple-plans'));

		expect(openLine).toEqual(expect.stringContaining('no ship request names this ticket yet'));
		expect(openLine).toEqual(expect.stringContaining('open'));
		expect(openLine).not.toEqual(expect.stringContaining('parked'));
		expect(logged).toContain('  worktree: /tmp/worktrees/lo-74-multiple-plans');
		expect(exitCodes).toStrictEqual([0]);
	});

	test('queueCommand: an open ticket beside a parked one still exits 2', async () => {
		const { context, logged, exitCodes } = setupQueueCommand({
			report: {
				outcomes: [
					openOutcomeOf({
						identifier: 'LO-74',
						title: 'Support multiple plans',
						branch: 'lo-74-multiple-plans',
						open: 'no ship request names this ticket yet',
					}),
					otherOutcomeOf({ identifier: 'LO-75', title: 'Fix the import', branch: 'lo-75-import', error: 'tsc: 3 errors' }),
				],
				leftBehind: [],
			},
		});

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain('LO-75 lo-75-import parked: tsc: 3 errors');
		expect(exitCodes).toStrictEqual([2]);
	});
});
