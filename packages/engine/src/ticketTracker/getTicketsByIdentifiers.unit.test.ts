import { describe, expect, jest, test } from '@jest/globals';
import { getTicketsByIdentifiers } from '#src/ticketTracker/getTicketsByIdentifiers.ts';
import { getTicketsByIdentifiers as jiraGetTicketsByIdentifiers } from '#src/ticketTracker/jira/getTicketsByIdentifiers.ts';
import { getTicketsByIdentifiers as linearGetTicketsByIdentifiers } from '#src/ticketTracker/linear/getTicketsByIdentifiers.ts';
import { jiraTrackerSettingsFixture } from '#tests/helpers/jiraQueueSettingsFixture.ts';

// Mocked Imports
// -------------------------
// Both provider adapters are doubled: what this file owns is which of the two a
// call reaches and with what, never what either one does. Each double is typed
// off the adapter it stands in for, so a signature that changes on one side
// fails here rather than at the first call that trusted the stub.
jest.mock('#src/ticketTracker/linear/getTicketsByIdentifiers.ts', () => ({ getTicketsByIdentifiers: jest.fn<typeof linearGetTicketsByIdentifiers>() }));
jest.mock('#src/ticketTracker/jira/getTicketsByIdentifiers.ts', () => ({ getTicketsByIdentifiers: jest.fn<typeof jiraGetTicketsByIdentifiers>() }));
// -------------------------

/** Both adapters answering successfully, so every test states only the answer it cares about. */
const setup = () => {
	const mockLinearGetTicketsByIdentifiers = jest.mocked(linearGetTicketsByIdentifiers);
	const mockJiraGetTicketsByIdentifiers = jest.mocked(jiraGetTicketsByIdentifiers);

	mockLinearGetTicketsByIdentifiers.mockResolvedValue([]);
	mockJiraGetTicketsByIdentifiers.mockResolvedValue([]);

	return { mockLinearGetTicketsByIdentifiers, mockJiraGetTicketsByIdentifiers };
};

describe('getTicketsByIdentifiers', () => {
	test('routes the call through Jira when the discriminant is jira', async () => {
		const { mockLinearGetTicketsByIdentifiers, mockJiraGetTicketsByIdentifiers } = setup();
		const settings = jiraTrackerSettingsFixture();

		await getTicketsByIdentifiers({ settings, identifiers: ['LO-1'] });

		expect(mockJiraGetTicketsByIdentifiers).toHaveBeenCalledWith({ settings, identifiers: ['LO-1'] });
		expect(mockLinearGetTicketsByIdentifiers).not.toHaveBeenCalled();
	});
});
