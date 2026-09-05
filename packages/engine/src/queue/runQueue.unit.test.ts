import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import { type LightsoutConfig, type RunManifest, RunStatus } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { ParkedWork } from '#src/queue/common/types/ParkedWork.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { runQueue } from '#src/queue/index.ts';
import type { ShipSettings } from '#src/ship/index.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
import { jiraTrackerSettingsFixture } from '#tests/helpers/jiraQueueSettingsFixture.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { shipSettingsFixture } from '#tests/helpers/shipSettingsFixture.ts';
import { terminalRelayFixture } from '#tests/helpers/terminalRelayFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// The tracker, the per-ticket run and the serial merge are each covered by their
// own tests. What this file owns is the order the drain works in, what it writes
// down, and the accounting it hands back — all observable with those stubbed.
/** The queue-owned chain every `git worktree add` goes through, as `runQueueTicket` receives it. */
type SerializeWorktreeAdd = <Result>(params: { task: () => Promise<Result> }) => Promise<Result>;

const mockListEligibleTickets = jest.fn<() => Promise<TicketSummary[] | QueueFailure>>();
const mockScanParkedWorktrees = jest.fn<() => Promise<ParkedWork | QueueFailure>>();
const mockRunQueueTicket = jest.fn<(params: { ticket: TicketSummary; serializeWorktreeAdd: SerializeWorktreeAdd }) => Promise<TicketRunOutcome>>();
const mockShipOneBranch = jest.fn<(params: { outcome: TicketRunOutcome }) => Promise<TicketRunOutcome>>();
/** The label write is covered by `setParkedLabel`'s own tests; what this file owns is which list the drain settles it over, and when. */
type LabelParams = { settings: TrackerSettings; ticketId: string; label: string | undefined; parked: boolean };

const mockSetParkedLabel = jest.fn<(params: LabelParams) => Promise<QueueFailure | undefined>>();

jest.mock('#src/queue/listEligibleTickets.ts', () => ({ listEligibleTickets: () => mockListEligibleTickets() }));
jest.mock('#src/ticketTracker/index.ts', () => ({
	listLabelNames: () =>
		Promise.resolve(['planning-needs-brainstorm', 'planning-needs-plan', 'planning-ready-auto-plan', 'planning-complete', 'planning-not-needed']),
	appendTicketNote: () => Promise.resolve(undefined),
	setParkedLabel: (params: LabelParams) => mockSetParkedLabel(params),
}));
jest.mock('#src/queue/scanParkedWorktrees.ts', () => ({ scanParkedWorktrees: () => mockScanParkedWorktrees() }));
jest.mock('#src/queue/runQueueTicket.ts', () => ({
	runQueueTicket: (params: { ticket: TicketSummary; serializeWorktreeAdd: SerializeWorktreeAdd }) => mockRunQueueTicket(params),
}));
jest.mock('#src/queue/shipOneBranch.ts', () => ({ shipOneBranch: (params: { outcome: TicketRunOutcome }) => mockShipOneBranch(params) }));
// -------------------------

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
const driver: Driver = { name: 'claude-code', invoke: () => Promise.resolve({ text: '', exitCode: 0 }) };

const shipSettings = shipSettingsFixture();

const ticketOf = ({
	number,
	priority = 2,
	createdAt = '2026-01-01T00:00:00.000Z',
	unfinishedBlockers = [],
	title = `Ticket ${number}`,
}: {
	number: number;
	priority?: number;
	createdAt?: string;
	unfinishedBlockers?: string[];
	title?: string;
}): TicketSummary => ({
	id: `id-${number}`,
	identifier: `LO-${number}`,
	title,
	description: '',
	priority,
	createdAt,
	labels: [],
	planningStatus: PlanningStatus.NotNeeded,
	worker: QueueWorker.Direct,
	status: 'Ready to implement',
	unfinishedBlockers,
});

const outcomeOf = ({ ticket, ready = true, error }: { ticket: TicketSummary; ready?: boolean; error?: string }): TicketRunOutcome => ({
	ticket,
	branch: `${ticket.identifier.toLowerCase()}-ticket-${ticket.id}`,
	worktreePath: `/tmp/worktrees/${ticket.identifier}`,
	ready,
	error,
});

/** A repo with a remote behind it and every collaborator stubbed green. */
const setupDrain = ({ eligible = [], parked }: { eligible?: TicketSummary[]; parked?: ParkedWork } = {}) => {
	const { cwd } = setupBranchRepo();

	execSync('git config user.name t && git config user.email t@t', { cwd, stdio: 'ignore' });
	mockListEligibleTickets.mockResolvedValue(eligible);
	mockScanParkedWorktrees.mockResolvedValue(parked ?? { resumed: [], outcomes: [], leftBehind: [], merged: [] });
	mockRunQueueTicket.mockImplementation(({ ticket }) => Promise.resolve(outcomeOf({ ticket })));
	mockShipOneBranch.mockImplementation(({ outcome }) => Promise.resolve(outcome));
	mockSetParkedLabel.mockResolvedValue(undefined);

	const relay = terminalRelayFixture();
	const progress: string[] = [];

	const drain = ({
		settings = queueSettingsFixture(),
		trackerSettings = trackerSettingsFixture(),
		ship = shipSettings,
	}: {
		settings?: QueueSettings;
		trackerSettings?: TrackerSettings;
		ship?: ShipSettings;
	} = {}) =>
		runQueue({
			cwd,
			settings,
			trackerSettings,
			shipSettings: ship,
			config,
			env: {},
			driver,
			driverName: 'claude-code',
			relay,
			onProgress: (message) => progress.push(message),
		});

	return { cwd, drain, relay, progress };
};

/** The one manifest the drain's coordinator run wrote. */
const readCoordinatorRun = ({ cwd }: { cwd: string }) => {
	const runsDir = join(cwd, '.lightsout', 'runs');
	const runId = readdirSync(runsDir)[0];
	const manifest = JSON.parse(readFileSync(join(runsDir, runId, 'manifest.json'), 'utf8')) as RunManifest;

	return { runId, manifest, planPath: join(runsDir, runId, 'queue.md') };
};

describe('runQueue', () => {
	test('refuses a branch template the ship pattern cannot read, naming both keys before any ticket is built', async () => {
		const { drain, relay } = setupDrain();

		const report = await drain({ settings: queueSettingsFixture({ branchTemplate: 'work/{slug}' }) });

		relay.close();

		expect(report).toEqual({ error: expect.stringContaining('`queue.branch-template`') });
		expect(report).toEqual({ error: expect.stringContaining('`ship.ticket-pattern`') });
	});

	test('starts under a ticket pattern scoped to the configured team, because the sample ticket is shaped from that team key', async () => {
		const { drain, relay } = setupDrain();

		const report = await drain({ ship: { ...shipSettings, ticketPattern: /^(?<ticket>lo-(?<number>\d+))/ } });

		relay.close();

		expect(report).toStrictEqual({ outcomes: [], leftBehind: [] });
	});

	test('starts Jira under a ticket pattern scoped to its ticket prefix', async () => {
		const { drain, relay } = setupDrain();

		const report = await drain({
			trackerSettings: jiraTrackerSettingsFixture({ project: 'OPS', ticketPrefix: 'OPS' }),
			ship: { ...shipSettings, ticketPattern: /^(?<ticket>ops-(?<number>\d+))/ },
		});

		relay.close();

		expect(report).toStrictEqual({ outcomes: [], leftBehind: [] });
	});

	test('refuses a repo with no remote default branch, the same refusal ship makes for the same reason', async () => {
		const { cwd } = setupBranchRepo({ remoteHead: false });
		const relay = terminalRelayFixture();

		const report = await runQueue({
			cwd,
			settings: queueSettingsFixture(),
			trackerSettings: trackerSettingsFixture(),
			shipSettings,
			config,
			env: {},
			driver,
			driverName: 'claude-code',
			relay,
		});

		relay.close();

		expect(report).toEqual({ error: expect.stringContaining('origin/HEAD') });
	});

	test('says there is nothing to do and leaves no run behind when the backlog is dry and no worktree is parked', async () => {
		const { cwd, drain, relay, progress } = setupDrain();

		const report = await drain();

		relay.close();

		expect(report).toStrictEqual({ outcomes: [], leftBehind: [] });
		expect(progress).toEqual([expect.stringContaining('nothing to do')]);
		expect(existsSync(join(cwd, '.lightsout', 'runs'))).toBe(false);
	});

	test('still names a worktree the resume scan left behind when there is nothing to drain, so it never vanishes from the summary', async () => {
		const withdrawn = { identifier: 'LO-99', reason: 'its worktree is parked, but the ticket carries no planning status label any more' };
		const { drain, relay } = setupDrain({ parked: { resumed: [], outcomes: [], leftBehind: [withdrawn], merged: [] } });

		const report = await drain();

		relay.close();

		expect(report).toStrictEqual({ outcomes: [], leftBehind: [withdrawn] });
	});

	test('hands a tracker failure back rather than draining what it managed to read', async () => {
		const { drain, relay } = setupDrain();

		mockListEligibleTickets.mockResolvedValue({ error: 'authentication failed' });

		expect(await drain()).toStrictEqual({ error: 'authentication failed' });

		relay.close();
	});

	test('hands a failed resume scan back too, so a restart stops rather than re-running parked work blind', async () => {
		const { drain, relay } = setupDrain({ eligible: [ticketOf({ number: 70 })] });

		mockScanParkedWorktrees.mockResolvedValue({ error: 'the tracker did not answer' });

		expect(await drain()).toStrictEqual({ error: 'the tracker did not answer' });

		relay.close();
	});

	test('works urgent tickets before low ones, and the oldest first within a priority', async () => {
		const { drain, relay } = setupDrain({
			eligible: [
				ticketOf({ number: 70, priority: 0 }),
				ticketOf({ number: 71, priority: 3, createdAt: '2026-03-01T00:00:00.000Z' }),
				ticketOf({ number: 72, priority: 1 }),
				ticketOf({ number: 73, priority: 3, createdAt: '2026-02-01T00:00:00.000Z' }),
				ticketOf({ number: 74, priority: 5 }),
			],
		});

		await drain({ settings: queueSettingsFixture({ maxParallel: 1 }) });
		relay.close();

		expect(mockRunQueueTicket.mock.calls.map((call) => call[0].ticket.identifier)).toStrictEqual(['LO-72', 'LO-73', 'LO-71', 'LO-74', 'LO-70']);
	});

	test('picks up parked tickets before any new one, because a restart is the resume path', async () => {
		const { drain, relay } = setupDrain({
			eligible: [ticketOf({ number: 70 })],
			parked: { resumed: [ticketOf({ number: 99 })], outcomes: [], leftBehind: [], merged: [] },
		});

		await drain({ settings: queueSettingsFixture({ maxParallel: 1 }) });
		relay.close();

		expect(mockRunQueueTicket.mock.calls.map((call) => call[0].ticket.identifier)).toStrictEqual(['LO-99', 'LO-70']);
	});

	test('records every ticket it will work in the coordinator run, naming the branch and the worktree a human can reach it in', async () => {
		const { cwd, drain, relay } = setupDrain({ eligible: [ticketOf({ number: 70 })] });

		await drain();
		relay.close();

		const { manifest, planPath } = readCoordinatorRun({ cwd });

		expect(manifest.pipeline).toBe('queue');
		expect(readFileSync(planPath, 'utf8')).toContain('LO-70 · direct · lo-70-ticket-70 ·');
	});

	test('records a branch cut to length for a ticket whose title offers no break point, rather than an over-long one', async () => {
		const longWord = ticketOf({ number: 71, title: 'Deterministicverificationpipelinerebuilds' });
		const { cwd, drain, relay } = setupDrain({ eligible: [longWord] });

		await drain();
		relay.close();

		expect(readFileSync(readCoordinatorRun({ cwd }).planPath, 'utf8')).toContain('LO-71 · direct · lo-71-deterministicverificationpipelinerebuild ·');
	});

	test('sends both the parked-and-ready branches and the freshly built ones to the merge, in the order they became ready', async () => {
		const alreadyReady = outcomeOf({ ticket: ticketOf({ number: 99 }) });
		const { drain, relay } = setupDrain({
			eligible: [ticketOf({ number: 70 })],
			parked: { resumed: [], outcomes: [alreadyReady], leftBehind: [], merged: [] },
		});

		await drain();
		relay.close();

		expect(mockShipOneBranch.mock.calls.map(([params]) => params.outcome.ticket.identifier)).toStrictEqual(['LO-99', 'LO-70']);
	});

	test('merges a parked branch that only needed shipping, without spending a worker on finished work', async () => {
		const alreadyReady = outcomeOf({ ticket: ticketOf({ number: 99 }) });
		const { drain, relay } = setupDrain({ parked: { resumed: [], outcomes: [alreadyReady], leftBehind: [], merged: [] } });

		const report = await drain();

		relay.close();

		expect(mockRunQueueTicket).not.toHaveBeenCalled();
		expect(report).toStrictEqual({ outcomes: [alreadyReady], leftBehind: [] });
	});

	test('lets only one ticket create a worktree at a time, because that step mutates the main checkout they share', async () => {
		const { drain, relay } = setupDrain({ eligible: [ticketOf({ number: 70 }), ticketOf({ number: 71 })] });
		let creating = 0;
		let mostAtOnce = 0;

		mockRunQueueTicket.mockImplementation(async ({ ticket, serializeWorktreeAdd }) => {
			await serializeWorktreeAdd({
				task: async () => {
					creating += 1;
					mostAtOnce = Math.max(mostAtOnce, creating);

					await new Promise((settle) => setTimeout(settle, 5));

					creating -= 1;
				},
			});

			return outcomeOf({ ticket });
		});

		await drain({ settings: queueSettingsFixture({ maxParallel: 2 }) });
		relay.close();

		expect(mockRunQueueTicket).toHaveBeenCalledTimes(2);
		expect(mostAtOnce).toBe(1);
	});

	test('ends the coordinator run passed when everything shipped and nothing was left behind', async () => {
		const { cwd, drain, relay } = setupDrain({ eligible: [ticketOf({ number: 70 })] });

		await drain();
		relay.close();

		expect(readCoordinatorRun({ cwd }).manifest.status).toBe(RunStatus.Passed);
	});

	test('ends the coordinator run escalated when a ticket parked, because the factory still holds work', async () => {
		const { cwd, drain, relay } = setupDrain({ eligible: [ticketOf({ number: 70 })] });

		mockRunQueueTicket.mockImplementation(({ ticket }) => Promise.resolve(outcomeOf({ ticket, ready: false, error: 'tsc: 3 errors' })));

		const report = await drain();

		relay.close();

		expect(report).toEqual({ outcomes: [expect.objectContaining({ ready: false })], leftBehind: [] });
		expect(readCoordinatorRun({ cwd }).manifest.status).toBe(RunStatus.Escalated);
	});

	test('carries a skipped ticket into the report beside the outcomes, so nothing vanishes from the summary', async () => {
		const { drain, relay } = setupDrain({
			eligible: [ticketOf({ number: 70 }), { ...ticketOf({ number: 70 }), planningStatus: PlanningStatus.Complete, worker: QueueWorker.Plan }],
			parked: { resumed: [], outcomes: [outcomeOf({ ticket: ticketOf({ number: 99 }) })], leftBehind: [], merged: [] },
		});

		const report = await drain();

		relay.close();

		expect(report).toEqual({
			outcomes: [expect.objectContaining({ ticket: expect.objectContaining({ identifier: 'LO-99' }) })],
			leftBehind: [{ identifier: 'LO-70', reason: expect.stringContaining('planning status labels') }],
		});
	});
});
