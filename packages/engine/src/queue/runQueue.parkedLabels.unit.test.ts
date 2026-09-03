import { execSync } from 'node:child_process';
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
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { shipSettingsFixture } from '#tests/helpers/shipSettingsFixture.ts';
import { terminalRelayFixture } from '#tests/helpers/terminalRelayFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// The park label is opt-in, written after the serial merge, and never a
// precondition for building — three claims about WHEN the drain writes it and
// over WHICH list, which is why this file stubs the write itself. What the
// write does to a tracker is `setParkedLabel`'s own test.
type LabelParams = { settings: TrackerSettings; ticketId: string; label: string | undefined; parked: boolean };

const mockListEligibleTickets = jest.fn<() => Promise<TicketSummary[] | QueueFailure>>();
const mockScanParkedWorktrees = jest.fn<() => Promise<ParkedWork | QueueFailure>>();
const mockRunQueueTicket = jest.fn<(params: { ticket: TicketSummary }) => Promise<TicketRunOutcome>>();
const mockShipReadyBranches = jest.fn<(params: { ready: TicketRunOutcome[] }) => Promise<TicketRunOutcome[]>>();
const mockSetParkedLabel = jest.fn<(params: LabelParams) => Promise<QueueFailure | undefined>>();

jest.mock('#src/queue/listEligibleTickets.ts', () => ({ listEligibleTickets: () => mockListEligibleTickets() }));
jest.mock('#src/ticketTracker/index.ts', () => ({
	listLabelNames: () =>
		Promise.resolve(['planning-needs-brainstorm', 'planning-needs-plan', 'planning-ready-auto-plan', 'planning-complete', 'planning-not-needed']),
	appendTicketNote: () => Promise.resolve(undefined),
	setParkedLabel: (params: LabelParams) => mockSetParkedLabel(params),
}));
jest.mock('#src/queue/scanParkedWorktrees.ts', () => ({ scanParkedWorktrees: () => mockScanParkedWorktrees() }));
jest.mock('#src/queue/runQueueTicket.ts', () => ({ runQueueTicket: (params: { ticket: TicketSummary }) => mockRunQueueTicket(params) }));
jest.mock('#src/queue/shipReadyBranches.ts', () => ({ shipReadyBranches: (params: { ready: TicketRunOutcome[] }) => mockShipReadyBranches(params) }));
// -------------------------

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
const driver: Driver = { name: 'claude-code', invoke: () => Promise.resolve({ text: '', exitCode: 0 }) };

const ticketOf = ({ number }: { number: number }): TicketSummary => ({
	id: `id-${number}`,
	identifier: `LO-${number}`,
	title: `Ticket ${number}`,
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: [],
	planningStatus: PlanningStatus.NotNeeded,
	worker: QueueWorker.Direct,
	status: 'Ready to implement',
	unfinishedBlockers: [],
});

const outcomeOf = ({ ticket, ready = true, error }: { ticket: TicketSummary; ready?: boolean; error?: string }): TicketRunOutcome => ({
	ticket,
	branch: `${ticket.identifier.toLowerCase()}-ticket-${ticket.id}`,
	worktreePath: `/tmp/worktrees/${ticket.identifier}`,
	ready,
	error,
});

/** A repo with a remote behind it and every collaborator stubbed green. */
const setupDrain = ({ eligible = [] }: { eligible?: TicketSummary[] } = {}) => {
	const { cwd } = setupBranchRepo();

	execSync('git config user.name t && git config user.email t@t', { cwd, stdio: 'ignore' });
	mockListEligibleTickets.mockResolvedValue(eligible);
	mockScanParkedWorktrees.mockResolvedValue({ resumed: [], outcomes: [], leftBehind: [] });
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

	return { drain, relay, progress };
};

describe('runQueue', () => {
	test('settles the parked label over the outcomes shipping left behind, so a ticket that failed to merge is parked in the tracker too', async () => {
		const merged = ticketOf({ number: 70 });
		const unmerged = ticketOf({ number: 71 });
		const { drain, relay } = setupDrain({ eligible: [merged, unmerged] });

		mockShipReadyBranches.mockResolvedValue([
			outcomeOf({ ticket: merged }),
			outcomeOf({ ticket: unmerged, ready: false, error: 'the branch did not rebase onto main' }),
		]);

		await drain({ settings: queueSettingsFixture({ parkedLabel: 'queue-parked' }) });
		relay.close();

		expect(mockSetParkedLabel.mock.calls.map(([params]) => ({ ticketId: params.ticketId, label: params.label, parked: params.parked }))).toStrictEqual([
			{ ticketId: 'id-70', label: 'queue-parked', parked: false },
			{ ticketId: 'id-71', label: 'queue-parked', parked: true },
		]);
	});

	test('reports a failed label write as progress and still hands the drain back, because the tracker is never a precondition for building', async () => {
		const { drain, relay, progress } = setupDrain({ eligible: [ticketOf({ number: 70 })] });

		mockSetParkedLabel.mockResolvedValue({ error: 'there is no LO team to create the label on' });

		const report = await drain({ settings: queueSettingsFixture({ parkedLabel: 'queue-parked' }) });

		relay.close();

		expect(report).toEqual({ outcomes: [expect.objectContaining({ ticket: expect.objectContaining({ identifier: 'LO-70' }), ready: true })], leftBehind: [] });
		expect(progress).toEqual([expect.stringContaining("LO-70 · the 'queue-parked' label could not be written")]);
	});

	test('leaves the tracker alone when no parked label is configured, because the label is opt-in', async () => {
		const parked = ticketOf({ number: 70 });
		const { drain, relay } = setupDrain({ eligible: [parked] });

		mockShipReadyBranches.mockResolvedValue([outcomeOf({ ticket: parked, ready: false, error: 'the branch did not rebase onto main' })]);

		await drain();
		relay.close();

		expect(mockSetParkedLabel).not.toHaveBeenCalled();
	});
});
