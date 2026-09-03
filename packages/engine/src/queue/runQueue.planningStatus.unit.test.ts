import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { ParkedWork } from '#src/queue/common/types/ParkedWork.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { runQueue } from '#src/queue/index.ts';
import type { TrackerFailure, TrackerSettings } from '#src/ticketTracker/index.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { shipSettingsFixture } from '#tests/helpers/shipSettingsFixture.ts';
import { terminalRelayFixture } from '#tests/helpers/terminalRelayFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// The planning-status half of the drain, which the base suite leaves alone: the
// two startup refusals a broken planning configuration earns, which worker each
// ticket is recorded against, and what the drain does with a pair that selects
// no worker at all. The label catalog is the one tracker read these refusals
// turn on, so it is a stub this file varies rather than a constant.
type LabelParams = { settings: TrackerSettings; ticketId: string; label: string | undefined; parked: boolean };

const mockListLabelNames = jest.fn<() => Promise<string[] | TrackerFailure>>();
const mockListEligibleTickets = jest.fn<() => Promise<TicketSummary[] | QueueFailure>>();
const mockScanParkedWorktrees = jest.fn<() => Promise<ParkedWork | QueueFailure>>();
const mockRunQueueTicket = jest.fn<(params: { ticket: TicketSummary }) => Promise<TicketRunOutcome>>();
const mockShipReadyBranches = jest.fn<(params: { ready: TicketRunOutcome[] }) => Promise<TicketRunOutcome[]>>();
const mockSetParkedLabel = jest.fn<(params: LabelParams) => Promise<QueueFailure | undefined>>();

jest.mock('#src/queue/listEligibleTickets.ts', () => ({ listEligibleTickets: () => mockListEligibleTickets() }));
jest.mock('#src/ticketTracker/index.ts', () => ({
	listLabelNames: () => mockListLabelNames(),
	appendTicketNote: () => Promise.resolve(undefined),
	setParkedLabel: (params: LabelParams) => mockSetParkedLabel(params),
}));
jest.mock('#src/queue/scanParkedWorktrees.ts', () => ({ scanParkedWorktrees: () => mockScanParkedWorktrees() }));
jest.mock('#src/queue/runQueueTicket.ts', () => ({ runQueueTicket: (params: { ticket: TicketSummary }) => mockRunQueueTicket(params) }));
jest.mock('#src/queue/shipReadyBranches.ts', () => ({ shipReadyBranches: (params: { ready: TicketRunOutcome[] }) => mockShipReadyBranches(params) }));
// -------------------------

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
const driver: Driver = { name: 'claude-code', invoke: () => Promise.resolve({ text: '', exitCode: 0 }) };
const everyLabel = ['planning-needs-brainstorm', 'planning-needs-plan', 'planning-ready-auto-plan', 'planning-complete', 'planning-not-needed'];

const ticketOf = ({
	number,
	planningStatus = PlanningStatus.NotNeeded,
	worker = QueueWorker.Direct,
	status = 'Ready to implement',
}: {
	number: number;
	planningStatus?: PlanningStatus;
	worker?: QueueWorker;
	status?: string;
}): TicketSummary => ({
	id: `id-${number}`,
	identifier: `LO-${number}`,
	title: `Ticket ${number}`,
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: [],
	planningStatus,
	worker,
	status,
	unfinishedBlockers: [],
});

/** A ticket the classifier left unselected: a pair the queue does not take. */
const unselectedTicketOf = ({ number, planningStatus }: { number: number; planningStatus: PlanningStatus }): TicketSummary => ({
	...ticketOf({ number, planningStatus, status: 'Backlog' }),
	worker: undefined,
});

const outcomeOf = ({ ticket }: { ticket: TicketSummary }): TicketRunOutcome => ({
	ticket,
	branch: `${ticket.identifier.toLowerCase()}-ticket-${ticket.id}`,
	worktreePath: `/tmp/worktrees/${ticket.identifier}`,
	ready: true,
});

/** A repo with a remote behind it, a tracker that knows every configured label, and every collaborator stubbed green. */
const setupDrain = ({ eligible = [], resumed = [] }: { eligible?: TicketSummary[]; resumed?: TicketSummary[] } = {}) => {
	const { cwd } = setupBranchRepo();

	execSync('git config user.name t && git config user.email t@t', { cwd, stdio: 'ignore' });
	mockListLabelNames.mockResolvedValue(everyLabel);
	mockListEligibleTickets.mockResolvedValue(eligible);
	mockScanParkedWorktrees.mockResolvedValue({ resumed, outcomes: [], leftBehind: [], merged: [] });
	mockRunQueueTicket.mockImplementation(({ ticket }) => Promise.resolve(outcomeOf({ ticket })));
	mockShipReadyBranches.mockImplementation(({ ready }) => Promise.resolve(ready));
	mockSetParkedLabel.mockResolvedValue(undefined);

	const relay = terminalRelayFixture();
	const progress: string[] = [];

	const drain = ({ settings = queueSettingsFixture() }: { settings?: QueueSettings } = {}) =>
		runQueue({
			cwd,
			settings,
			trackerSettings: trackerSettingsFixture(),
			shipSettings: shipSettingsFixture(),
			config,
			env: {},
			driver,
			driverName: 'claude-code',
			relay,
			onProgress: (message) => progress.push(message),
		});

	return { cwd, drain, relay, progress };
};

/** The identifiers a worker was actually spent on, in pickup order. */
const pickedUp = () => mockRunQueueTicket.mock.calls.map((call) => call[0].ticket.identifier);

/** The `queue.md` the one coordinator run wrote — one line per ticket any wave picked up. */
const readQueuePlan = ({ cwd }: { cwd: string }) => {
	const runsDir = join(cwd, '.lightsout', 'runs');
	const runId = readdirSync(runsDir)[0];

	return readFileSync(join(runsDir, runId, 'queue.md'), 'utf8');
};

describe('runQueue', () => {
	test('refuses when the tracker knows none of the configured planning status labels, naming every missing one before it reads the backlog', async () => {
		const { drain, relay } = setupDrain();

		mockListLabelNames.mockResolvedValue(['planning-complete', 'planning-not-needed']);

		const report = await drain();

		relay.close();

		expect(report).toEqual({ error: expect.stringContaining("'planning-needs-brainstorm', 'planning-needs-plan', 'planning-ready-auto-plan'") });
		expect(mockListEligibleTickets).not.toHaveBeenCalled();
		expect(mockScanParkedWorktrees).not.toHaveBeenCalled();
	});

	test('refuses a ready status the eligible query never asks for without spending a single tracker read on it', async () => {
		const settings = queueSettingsFixture();
		const { drain, relay } = setupDrain();

		const report = await drain({ settings: { ...settings, lifecycle: { ...settings.lifecycle, eligibleStatuses: ['Backlog'] } } });

		relay.close();

		expect(report).toEqual({ error: expect.stringContaining('`queue.ready-status`') });
		expect(mockListLabelNames).not.toHaveBeenCalled();
		expect(mockListEligibleTickets).not.toHaveBeenCalled();
	});

	test('records the worker each ticket was selected for in the coordinator run, so a plan ticket is never read as a direct one', async () => {
		const { cwd, drain, relay } = setupDrain({
			eligible: [
				ticketOf({ number: 70 }),
				ticketOf({ number: 71, planningStatus: PlanningStatus.Complete, worker: QueueWorker.Plan }),
				ticketOf({ number: 72, planningStatus: PlanningStatus.ReadyAutoPlan, worker: QueueWorker.AutoPlan, status: 'Backlog' }),
			],
			resumed: [ticketOf({ number: 99, planningStatus: PlanningStatus.Complete, worker: QueueWorker.Plan, status: 'In Progress' })],
		});

		await drain();
		relay.close();

		const plan = readQueuePlan({ cwd });

		expect(plan).toContain('LO-99 · plan · lo-99-ticket-99 ·');
		expect(plan).toContain('LO-70 · direct · lo-70-ticket-70 ·');
		expect(plan).toContain('LO-71 · plan · lo-71-ticket-71 ·');
		expect(plan).toContain('LO-72 · auto-plan · lo-72-ticket-72 ·');
	});

	test('drops a ticket whose pair selects no worker without spending one on it, and without naming it in the report', async () => {
		const { drain, relay } = setupDrain({
			eligible: [unselectedTicketOf({ number: 70, planningStatus: PlanningStatus.NeedsPlan }), ticketOf({ number: 71 })],
		});

		const report = await drain();

		relay.close();

		expect(pickedUp()).toStrictEqual(['LO-71']);
		expect(report).toEqual({ outcomes: [expect.objectContaining({ ticket: expect.objectContaining({ identifier: 'LO-71' }) })], leftBehind: [] });
	});

	test('says there is nothing to do and takes no run lock when every eligible ticket is still being shaped', async () => {
		const { cwd, drain, relay, progress } = setupDrain({
			eligible: [
				unselectedTicketOf({ number: 70, planningStatus: PlanningStatus.NeedsBrainstorm }),
				unselectedTicketOf({ number: 71, planningStatus: PlanningStatus.NeedsPlan }),
			],
		});

		const report = await drain();

		relay.close();

		expect(report).toStrictEqual({ outcomes: [], leftBehind: [] });
		expect(progress).toEqual([expect.stringContaining('nothing to do')]);
		expect(existsSync(join(cwd, '.lightsout', 'runs'))).toBe(false);
	});
});
