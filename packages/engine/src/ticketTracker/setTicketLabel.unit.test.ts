import { describe, expect, jest, test } from '@jest/globals';
import { setTicketLabel as jiraSetTicketLabel } from '#src/ticketTracker/jira/setTicketLabel.ts';
import { setTicketLabel as linearSetTicketLabel } from '#src/ticketTracker/linear/setTicketLabel.ts';
import { setTicketLabel } from '#src/ticketTracker/setTicketLabel.ts';
import { jiraTrackerSettingsFixture } from '#tests/helpers/jiraQueueSettingsFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// Both provider adapters are doubled: what this file owns is which of the two a
// call reaches and with what, never what either one does. Each double is typed
// off the adapter it stands in for, so a signature that changes on one side
// fails here rather than at the first call that trusted the stub.
jest.mock('#src/ticketTracker/linear/setTicketLabel.ts', () => ({ setTicketLabel: jest.fn<typeof linearSetTicketLabel>() }));
jest.mock('#src/ticketTracker/jira/setTicketLabel.ts', () => ({ setTicketLabel: jest.fn<typeof jiraSetTicketLabel>() }));
// -------------------------

/** Both adapters answering successfully, so every test states only the answer it cares about. */
const setup = () => {
	const mockLinearSetTicketLabel = jest.mocked(linearSetTicketLabel);
	const mockJiraSetTicketLabel = jest.mocked(jiraSetTicketLabel);

	mockLinearSetTicketLabel.mockResolvedValue(undefined);
	mockJiraSetTicketLabel.mockResolvedValue(undefined);

	return { mockLinearSetTicketLabel, mockJiraSetTicketLabel };
};

describe('setTicketLabel', () => {
	test('routes the call through Jira when the discriminant is jira', async () => {
		const { mockLinearSetTicketLabel, mockJiraSetTicketLabel } = setup();
		const settings = jiraTrackerSettingsFixture();

		await setTicketLabel({ settings, ticketId: '1001', label: 'parked', present: true });

		expect(mockJiraSetTicketLabel).toHaveBeenCalledWith({ settings, ticketId: '1001', label: 'parked', present: true });
		expect(mockLinearSetTicketLabel).not.toHaveBeenCalled();
	});

	test('dispatches by provider with the present flag', async () => {
		const { mockLinearSetTicketLabel, mockJiraSetTicketLabel } = setup();
		const linearSettings = trackerSettingsFixture();
		const jiraSettings = jiraTrackerSettingsFixture();

		await setTicketLabel({ settings: linearSettings, ticketId: '1001', label: 'queue-blocked-gate-timed-out', present: true });
		await setTicketLabel({ settings: jiraSettings, ticketId: '2002', label: 'queue-blocked-gate-timed-out', present: false });

		expect(mockLinearSetTicketLabel).toHaveBeenCalledWith({
			settings: linearSettings,
			ticketId: '1001',
			label: 'queue-blocked-gate-timed-out',
			present: true,
		});
		expect(mockJiraSetTicketLabel).toHaveBeenCalledWith({
			settings: jiraSettings,
			ticketId: '2002',
			label: 'queue-blocked-gate-timed-out',
			present: false,
		});
		expect(mockLinearSetTicketLabel).toHaveBeenCalledTimes(1);
		expect(mockJiraSetTicketLabel).toHaveBeenCalledTimes(1);
	});

	test('answers the failure its provider answered when a ticket label write fails', async () => {
		const { mockLinearSetTicketLabel } = setup();
		const settings = trackerSettingsFixture();

		mockLinearSetTicketLabel.mockResolvedValue({ error: "the 'LO' team has no 'queue-blocked-gate-timed-out' label" });

		const failure = await setTicketLabel({ settings, ticketId: '1001', label: 'queue-blocked-gate-timed-out', present: true });

		expect(failure).toStrictEqual({ error: "the 'LO' team has no 'queue-blocked-gate-timed-out' label" });
	});

	test('answers undefined when its provider wrote the ticket label', async () => {
		setup();

		const settings = jiraTrackerSettingsFixture();

		const failure = await setTicketLabel({ settings, ticketId: '2002', label: 'queue-blocked-gate-timed-out', present: false });

		expect(failure).toBeUndefined();
	});
});
