import { describe, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import { type LifecycleSettings, TrackerStatusRole, updateTicketLifecycle } from '#src/ticketLifecycle/index.ts';
import type { TrackerFailure, TrackerSettings } from '#src/ticketTracker/index.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// The two seam writes this composes are each covered by their own tests. What
// this file owns is which of them run, in which order, and which failure stops
// the other from running at all.
type ExclusiveLabelParams = { settings: TrackerSettings; ticketId: string; label: string; groupLabels: string[] };
type TicketStatusParams = { settings: TrackerSettings; ticketId: string; statusName: string };

const mockSetExclusiveLabel = jest.fn<(params: ExclusiveLabelParams) => Promise<TrackerFailure | undefined>>();
const mockSetTicketStatus = jest.fn<(params: TicketStatusParams) => Promise<TrackerFailure | undefined>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	setExclusiveLabel: (params: ExclusiveLabelParams) => mockSetExclusiveLabel(params),
	setTicketStatus: (params: TicketStatusParams) => mockSetTicketStatus(params),
}));
// -------------------------

/**
 * Every label and status name is spelled unlike its role here, so a test that
 * passes proves the write read the configured map rather than the vocabulary.
 */
const lifecycle: LifecycleSettings = {
	planningStatusLabels: {
		'planning-needs-brainstorm': 'shaping-brainstorm',
		'planning-needs-plan': 'shaping-plan',
		'planning-ready-auto-plan': 'shaping-auto',
		'planning-complete': 'shaped',
		'planning-not-needed': 'shaped-none',
	},
	statusNames: { ready: 'Waiting', 'in-progress': 'Building', done: 'Shipped' },
	eligibleStatuses: ['Backlog', 'Waiting'],
};

/** Both seam writes stubbed, each recording its turn so the order between them is observable. */
const setupLifecycleWrite = ({ labelFailure, statusFailure }: { labelFailure?: TrackerFailure; statusFailure?: TrackerFailure } = {}) => {
	const written: string[] = [];

	mockSetExclusiveLabel.mockImplementation(({ label }) => {
		written.push(`label ${label}`);

		return Promise.resolve(labelFailure);
	});
	mockSetTicketStatus.mockImplementation(({ statusName }) => {
		written.push(`status ${statusName}`);

		return Promise.resolve(statusFailure);
	});

	const update = (params: { planningStatus?: PlanningStatus; trackerStatus?: TrackerStatusRole; currentStatus?: string }) =>
		updateTicketLifecycle({ lifecycle, trackerSettings: trackerSettingsFixture(), ticketId: 'id-70', ...params });

	return { update, written };
};

describe('updateTicketLifecycle', () => {
	test('writes the planning label against the whole group, so the four the ticket must not carry come off in the same write', async () => {
		const { update } = setupLifecycleWrite();

		await update({ planningStatus: PlanningStatus.Complete });

		expect(mockSetExclusiveLabel).toHaveBeenCalledWith(
			expect.objectContaining({
				ticketId: 'id-70',
				label: 'shaped',
				groupLabels: ['shaping-brainstorm', 'shaping-plan', 'shaping-auto', 'shaped', 'shaped-none'],
			}),
		);
	});

	test('turns the status role into the repository’s own spelling, which is what keeps every caller free of status strings', async () => {
		const { update } = setupLifecycleWrite();

		await update({ trackerStatus: TrackerStatusRole.InProgress, currentStatus: 'Backlog' });

		expect(mockSetTicketStatus).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 'id-70', statusName: 'Building' }));
	});

	test('writes the planning label before the status, because the status is the visible ownership marker', async () => {
		const { update, written } = setupLifecycleWrite();

		await update({ planningStatus: PlanningStatus.NotNeeded, trackerStatus: TrackerStatusRole.Ready, currentStatus: 'Backlog' });

		expect(written).toStrictEqual(['label shaped-none', 'status Waiting']);
	});

	test('returns nothing when both writes it was asked for succeeded', async () => {
		const { update } = setupLifecycleWrite();

		const failure = await update({ planningStatus: PlanningStatus.Complete, trackerStatus: TrackerStatusRole.Done, currentStatus: 'Building' });

		expect(failure).toBeUndefined();
	});

	test('stops before the status move when the planning label could not be written — In Progress while shaping is owed is worse than no move', async () => {
		const { update, written } = setupLifecycleWrite({ labelFailure: { error: "the 'LO' team has no 'shaped' label" } });

		const failure = await update({ planningStatus: PlanningStatus.Complete, trackerStatus: TrackerStatusRole.InProgress, currentStatus: 'Backlog' });

		expect(failure).toStrictEqual({ error: "the 'LO' team has no 'shaped' label" });
		expect(written).toStrictEqual(['label shaped']);
	});

	test('hands back the tracker’s own refusal of the status move, so a caller can park the ticket on it', async () => {
		const { update } = setupLifecycleWrite({ statusFailure: { error: "Jira ticket 'id-70' has no 'Building' transition" } });

		const failure = await update({ trackerStatus: TrackerStatusRole.InProgress, currentStatus: 'Backlog' });

		expect(failure).toStrictEqual({ error: "Jira ticket 'id-70' has no 'Building' transition" });
	});

	test('skips the status write when the ticket already holds the target, because a workflow with no self-transition parks every resumed ticket', async () => {
		const { update, written } = setupLifecycleWrite({ statusFailure: { error: "Jira ticket 'id-70' has no 'Building' transition" } });

		const failure = await update({ trackerStatus: TrackerStatusRole.InProgress, currentStatus: 'Building' });

		expect(failure).toBeUndefined();
		expect(written).toStrictEqual([]);
	});

	test('moves a ticket whose status the caller never read, rather than assuming it is already there', async () => {
		const { update, written } = setupLifecycleWrite();

		await update({ trackerStatus: TrackerStatusRole.InProgress });

		expect(written).toStrictEqual(['status Building']);
	});

	test('writes the planning label alone when no status role was named, leaving implementation where it stands', async () => {
		const { update, written } = setupLifecycleWrite();

		await update({ planningStatus: PlanningStatus.ReadyAutoPlan });

		expect(written).toStrictEqual(['label shaping-auto']);
	});

	test('touches the tracker at all only when it was asked for one of the two fields', async () => {
		const { update, written } = setupLifecycleWrite();

		const failure = await update({});

		expect(failure).toBeUndefined();
		expect(written).toStrictEqual([]);
	});
});
