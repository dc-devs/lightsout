import { describe, expect, jest, test } from '@jest/globals';
import { queueCommand } from '#src/cli/queueCommand.ts';
import type { QueueDrainReport, QueueFailure, QueueSettings, TicketRunOutcome } from '#src/queue/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// Mocked Imports
// -------------------------
// The drain spawns harnesses and talks to a tracker — the queue module's entry
// point, covered by its own tests. What this command owns is the config it
// refuses, the terminal it opens and closes, the summary it prints and the code
// it exits on, all observable with the drain stubbed.
const mockResolveQueueSettings = jest.fn<() => QueueSettings | QueueFailure>();
const mockRunQueue = jest.fn<() => Promise<QueueDrainReport | QueueFailure>>();
const mockRelayClosed = jest.fn<() => void>();

jest.mock('#src/queue/index.ts', () => ({
	resolveQueueSettings: () => mockResolveQueueSettings(),
	runQueue: () => mockRunQueue(),
	QuestionRelay: class {
		close() {
			mockRelayClosed();
		}
	},
}));
// -------------------------

const settings: QueueSettings = {
	team: 'LO',
	routeLabels: { direct: 'route-direct', 'auto-plan': 'route-auto-plan' },
	maxParallel: 2,
	apiKey: 'lin_key',
	eligibleStatuses: ['Backlog'],
	inProgressStatus: 'In Progress',
	branchTemplate: '{ticket}-{slug}',
	decisionsHeading: '## Decisions',
	workerMinutes: 240,
};

const outcomeOf = ({ ready, error }: { ready: boolean; error?: string }): TicketRunOutcome => ({
	ticket: {
		id: 'id-70',
		identifier: 'LO-70',
		title: 'Drain the backlog',
		description: '',
		priority: 2,
		createdAt: '2026-01-01T00:00:00.000Z',
		route: 'direct',
	},
	branch: 'lo-70-drain',
	worktreePath: '/tmp/worktrees/lo-70-drain',
	ready,
	error,
});

/** A repo whose config carries a ship block, with the drain stubbed to hand back this report. */
const setupQueueCommand = ({
	report,
	ship = { 'ticket-pattern': '^(?<ticket>[a-z]+-\\d+)' },
}: {
	report?: QueueDrainReport | QueueFailure;
	ship?: unknown;
}) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ config: { ship } });

	mockResolveQueueSettings.mockReturnValue(settings);
	mockRunQueue.mockResolvedValue(report ?? { outcomes: [], leftBehind: [] });

	return { context: { flags: new Map<string, string | true>(), rest: [], cwd }, cwd, ...captured };
};

describe('queueCommand', () => {
	test('a drain where everything shipped names each ticket and exits 0', async () => {
		const { context, logged, exitCodes } = setupQueueCommand({ report: { outcomes: [outcomeOf({ ready: true })], leftBehind: [] } });

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain('LO-70 lo-70-drain shipped');
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
			report: { outcomes: [], leftBehind: [{ identifier: 'LO-71', reason: 'skipped: it carries both route labels' }] },
		});

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain('LO-71 skipped: it carries both route labels');
		expect(exitCodes).toStrictEqual([2]);
	});

	test('a refusal from the drain goes to stderr and exits 1, because no drain happened', async () => {
		const { context, errors, exitCodes } = setupQueueCommand({ report: { error: 'authentication failed' } });

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors).toStrictEqual(['authentication failed']);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('refuses an unusable queue block before a terminal is ever opened', async () => {
		const { context, errors, exitCodes } = setupQueueCommand({});

		mockResolveQueueSettings.mockReturnValue({ error: '`lightsout queue` needs a `queue` block in lightsout.config.json' });

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors).toStrictEqual(['`lightsout queue` needs a `queue` block in lightsout.config.json']);
		expect(mockRunQueue).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test('refuses an unshippable ticket pattern up front, rather than after N tickets have been built', async () => {
		const { context, errors, exitCodes } = setupQueueCommand({ ship: { 'ticket-pattern': '^(?<broken>' } });

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors[0]).toContain('ship.ticket-pattern');
		expect(mockRunQueue).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test('closes the terminal on the way out, so a finished drain never leaves it half-open', async () => {
		const { context } = setupQueueCommand({});

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockRelayClosed).toHaveBeenCalledTimes(1);
	});

	test('closes the terminal even when the drain itself threw', async () => {
		const { context } = setupQueueCommand({});

		mockRunQueue.mockRejectedValue(new Error('another run holds the lock'));

		await expect(queueCommand(context)).rejects.toThrow('another run holds the lock');

		expect(mockRelayClosed).toHaveBeenCalledTimes(1);
	});
});
