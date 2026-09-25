import { describe, expect, jest, test } from '@jest/globals';
import { setTicketStatus as jiraSetTicketStatus } from '#src/ticketTracker/jira/setTicketStatus.ts';
import { setTicketStatus as linearSetTicketStatus } from '#src/ticketTracker/linear/setTicketStatus.ts';
import { setTicketStatus } from '#src/ticketTracker/setTicketStatus.ts';
import { jiraTrackerSettingsFixture } from '#tests/helpers/jiraQueueSettingsFixture.ts';

// Mocked Imports
// -------------------------
// Both provider adapters are doubled: what this file owns is which of the two a
// call reaches and with what, never what either one does. Each double is typed
// off the adapter it stands in for, so a signature that changes on one side
// fails here rather than at the first call that trusted the stub.
jest.mock('#src/ticketTracker/linear/setTicketStatus.ts', () => ({ setTicketStatus: jest.fn<typeof linearSetTicketStatus>() }));
jest.mock('#src/ticketTracker/jira/setTicketStatus.ts', () => ({ setTicketStatus: jest.fn<typeof jiraSetTicketStatus>() }));
// -------------------------

/** Both adapters answering successfully, so every test states only the answer it cares about. */
const setup = () => {
	const mockLinearSetTicketStatus = jest.mocked(linearSetTicketStatus);
	const mockJiraSetTicketStatus = jest.mocked(jiraSetTicketStatus);

	mockLinearSetTicketStatus.mockResolvedValue(undefined);
	mockJiraSetTicketStatus.mockResolvedValue(undefined);

	return { mockLinearSetTicketStatus, mockJiraSetTicketStatus };
};

describe('setTicketStatus', () => {
	test('routes the call through Jira when the discriminant is jira', async () => {
		const { mockLinearSetTicketStatus, mockJiraSetTicketStatus } = setup();
		const settings = jiraTrackerSettingsFixture();

		await setTicketStatus({ settings, ticketId: '1001', statusName: 'Done' });

		expect(mockJiraSetTicketStatus).toHaveBeenCalledWith({ settings, ticketId: '1001', statusName: 'Done' });
		expect(mockLinearSetTicketStatus).not.toHaveBeenCalled();
	});
});
