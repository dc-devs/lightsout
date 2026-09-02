import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { queueCommand } from '#src/cli/queueCommand.ts';
import type { QueueDrainReport, QueueFailure, QueueSettings, TicketRunOutcome } from '#src/queue/index.ts';
import type { TrackerFailure, TrackerSettings } from '#src/ticketTracker/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// The drain spawns harnesses and talks to a tracker — the queue module's entry
// point, covered by its own tests. What this command owns is the config it
// refuses, the terminal it opens and closes, the summary it prints and the code
// it exits on, all observable with the drain stubbed.
type RunQueueParams = Parameters<typeof import('#src/queue/index.ts').runQueue>[0];
/** What each relay constructor was handed — enough of it to read the two settings objects the command threads in. */
type RelayParams = { settings: QueueSettings; trackerSettings: TrackerSettings };

const mockResolveQueueSettings = jest.fn<() => QueueSettings | QueueFailure>();
const mockResolveTrackerSettings = jest.fn<() => TrackerSettings | TrackerFailure>();
const mockRunQueue = jest.fn<(params: RunQueueParams) => Promise<QueueDrainReport | QueueFailure>>();
const mockRelayClosed = jest.fn<() => void>();
const mockEmptyRelayMailbox = jest.fn<(params: { directory: string }) => Promise<void>>();
/** Which relay the command built, in the order it built them — the one decision the flag exists to make. */
const relaysBuilt: string[] = [];
/** What each relay was built with, in the same order — the settings a relayed answer is written through. */
const relayParams: RelayParams[] = [];

jest.mock('#src/queue/index.ts', () => ({
	resolveQueueSettings: () => mockResolveQueueSettings(),
	runQueue: (params: RunQueueParams) => mockRunQueue(params),
	emptyRelayMailbox: (params: { directory: string }) => mockEmptyRelayMailbox(params),
	TerminalQuestionRelay: class {
		constructor(params: RelayParams) {
			relaysBuilt.push('terminal');
			relayParams.push(params);
		}

		close() {
			mockRelayClosed();
		}
	},
	FileQuestionRelay: class {
		constructor(params: RelayParams) {
			relaysBuilt.push('file');
			relayParams.push(params);
		}

		close() {
			mockRelayClosed();
		}
	},
}));
jest.mock('#src/ticketTracker/index.ts', () => ({ resolveTrackerSettings: () => mockResolveTrackerSettings() }));
// -------------------------

const settings = queueSettingsFixture();
const trackerSettings = trackerSettingsFixture();

const outcomeOf = ({ ready, error }: { ready: boolean; error?: string }): TicketRunOutcome => ({
	ticket: {
		id: 'id-70',
		identifier: 'LO-70',
		title: 'Drain the backlog',
		description: '',
		priority: 2,
		createdAt: '2026-01-01T00:00:00.000Z',
		labels: [],
		route: 'direct',
		unfinishedBlockers: [],
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
	fileRelay,
}: {
	report?: QueueDrainReport | QueueFailure;
	ship?: unknown;
	/** What `--file-relay` carried: absent for no flag, true for a bare one, a path for a named mailbox. */
	fileRelay?: string | true;
}) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ config: { ship } });

	mockResolveQueueSettings.mockReturnValue(settings);
	mockResolveTrackerSettings.mockReturnValue(trackerSettings);
	mockRunQueue.mockResolvedValue(report ?? { outcomes: [], leftBehind: [] });
	mockEmptyRelayMailbox.mockResolvedValue(undefined);
	relaysBuilt.length = 0;
	relayParams.length = 0;

	const flags = new Map<string, string | true>();

	if (fileRelay !== undefined) {
		flags.set('file-relay', fileRelay);
	}

	return { context: { flags, rest: [], cwd }, cwd, ...captured };
};

/** A lock file naming this pid, which is alive by definition — what a second drain would find mid-run. */
const holdRunLock = ({ cwd, pid }: { cwd: string; pid: number }) => {
	mkdirSync(join(cwd, '.lightsout'), { recursive: true });
	writeFileSync(join(cwd, '.lightsout', 'lock.json'), JSON.stringify({ pid, runId: 'run-live', startedAt: '2026-01-01T00:00:00.000Z' }), 'utf8');
};

describe('queueCommand', () => {
	test('a drain where everything shipped names each ticket and exits 0', async () => {
		const { context, logged, exitCodes } = setupQueueCommand({ report: { outcomes: [outcomeOf({ ready: true })], leftBehind: [] } });

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain('LO-70 lo-70-drain shipped');
		expect(exitCodes).toStrictEqual([0]);
	});

	test('marks its own process no-ship before draining, so a worker implement run can never chain into ship', async () => {
		delete process.env.LIGHTSOUT_NO_SHIP;

		const { context } = setupQueueCommand({ report: { outcomes: [], leftBehind: [] } });

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		expect(process.env.LIGHTSOUT_NO_SHIP).toBe('1');
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

	test('refuses a config with no ticket-tracker block, because a drain cannot reach a tracker without one', async () => {
		const { context, errors, exitCodes } = setupQueueCommand({});

		mockResolveTrackerSettings.mockReturnValue({
			error: 'this command needs a `ticket-tracker` block in lightsout.config.json naming provider, team and api-key-env',
		});

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		// the queue requires both blocks and says which one is missing — a fallback
		// reading identity out of `queue` would leave two spellings of one fact
		expect(errors).toStrictEqual(['this command needs a `ticket-tracker` block in lightsout.config.json naming provider, team and api-key-env']);
		expect(mockRunQueue).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test('refuses a missing tracker API key by naming the variable to set, which is a different thing to fix than a missing block', async () => {
		const { context, errors, exitCodes } = setupQueueCommand({});

		mockResolveTrackerSettings.mockReturnValue({ error: 'the tracker API key is missing: set the `LINEAR_API_KEY` environment variable' });

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors).toStrictEqual(['the tracker API key is missing: set the `LINEAR_API_KEY` environment variable']);
		expect(mockRunQueue).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a repo carrying neither block hears about `queue`, the block the command is named for, rather than about a tracker it never reached', async () => {
		const { context, errors, exitCodes } = setupQueueCommand({});

		mockResolveQueueSettings.mockReturnValue({
			error: '`lightsout queue` needs a `queue` block in lightsout.config.json naming route-labels and max-parallel',
		});
		mockResolveTrackerSettings.mockReturnValue({
			error: 'this command needs a `ticket-tracker` block in lightsout.config.json naming provider, team and api-key-env',
		});

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors).toStrictEqual(['`lightsout queue` needs a `queue` block in lightsout.config.json naming route-labels and max-parallel']);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('hands the drain the tracker identity beside the queue settings, so the two are carried as separate facts', async () => {
		const { context } = setupQueueCommand({});

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockRunQueue).toHaveBeenCalledWith(expect.objectContaining({ settings, trackerSettings }));
	});

	test('hands the tracker identity to the terminal relay, so a relayed answer is written to the tracker the drain read from', async () => {
		const { context } = setupQueueCommand({});

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		expect(relayParams[0]).toEqual(expect.objectContaining({ settings, trackerSettings }));
	});

	test('hands the tracker identity to the mailbox relay as well, so which relay the flag chose changes nothing about it', async () => {
		const { context } = setupQueueCommand({ fileRelay: true });

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		expect(relayParams[0]).toEqual(expect.objectContaining({ settings, trackerSettings }));
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

	test('asks on this terminal when no mailbox was asked for, so the default loses nothing', async () => {
		const { context } = setupQueueCommand({});

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		expect(relaysBuilt).toStrictEqual(['terminal']);
		expect(mockEmptyRelayMailbox).not.toHaveBeenCalled();
	});

	test('a bare --file-relay empties the default mailbox and says where it landed', async () => {
		const { context, cwd, logged } = setupQueueCommand({ fileRelay: true });

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		const directory = resolve(cwd, '.lightsout', 'queue', 'relay');

		expect(relaysBuilt).toStrictEqual(['file']);
		expect(mockEmptyRelayMailbox).toHaveBeenCalledWith({ directory });
		expect(logged).toContain(`relaying questions through ${directory}`);
	});

	test('a --file-relay path resolves against the repo, like every other path the CLI takes', async () => {
		const { context, cwd } = setupQueueCommand({ fileRelay: 'mailbox' });

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockEmptyRelayMailbox).toHaveBeenCalledWith({ directory: resolve(cwd, 'mailbox') });
	});

	test('refuses rather than emptying the mailbox of a drain that is still running', async () => {
		const { context, cwd, errors, exitCodes } = setupQueueCommand({ fileRelay: true });

		holdRunLock({ cwd, pid: process.pid });

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors[0]).toContain('another lightsout run is active in this repo: run run-live');
		expect(mockEmptyRelayMailbox).not.toHaveBeenCalled();
		expect(mockRunQueue).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test('empties the mailbox left by a crashed drain, because those questions are dead', async () => {
		const { context, cwd } = setupQueueCommand({ fileRelay: true });

		// A pid nothing can be running under: the lock is a crash leftover.
		holdRunLock({ cwd, pid: 2 ** 30 });

		await expect(queueCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockEmptyRelayMailbox).toHaveBeenCalledWith({ directory: resolve(cwd, '.lightsout', 'queue', 'relay') });
	});

	test('closes the terminal even when the drain itself threw', async () => {
		const { context } = setupQueueCommand({});

		mockRunQueue.mockRejectedValue(new Error('another run holds the lock'));

		await expect(queueCommand(context)).rejects.toThrow('another run holds the lock');

		expect(mockRelayClosed).toHaveBeenCalledTimes(1);
	});
});
