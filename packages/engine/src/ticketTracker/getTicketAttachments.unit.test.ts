import { describe, expect, jest, test } from '@jest/globals';
import { getTicketAttachments } from '#src/ticketTracker/getTicketAttachments.ts';
import { getTicketAttachments as jiraGetTicketAttachments } from '#src/ticketTracker/jira/getTicketAttachments.ts';
import { getTicketAttachments as linearGetTicketAttachments } from '#src/ticketTracker/linear/getTicketAttachments.ts';
import { jiraTrackerSettingsFixture } from '#tests/helpers/jiraQueueSettingsFixture.ts';

// Mocked Imports
// -------------------------
// Both provider adapters are doubled: what this file owns is which of the two a
// call reaches and with what, never what either one does. Each double is typed
// off the adapter it stands in for, so a signature that changes on one side
// fails here rather than at the first call that trusted the stub.
jest.mock('#src/ticketTracker/linear/getTicketAttachments.ts', () => ({ getTicketAttachments: jest.fn<typeof linearGetTicketAttachments>() }));
jest.mock('#src/ticketTracker/jira/getTicketAttachments.ts', () => ({ getTicketAttachments: jest.fn<typeof jiraGetTicketAttachments>() }));
// -------------------------

/** Both adapters answering successfully, so every test states only the answer it cares about. */
const setup = () => {
	const mockLinearGetTicketAttachments = jest.mocked(linearGetTicketAttachments);
	const mockJiraGetTicketAttachments = jest.mocked(jiraGetTicketAttachments);

	mockLinearGetTicketAttachments.mockResolvedValue([]);
	mockJiraGetTicketAttachments.mockResolvedValue([]);

	return { mockLinearGetTicketAttachments, mockJiraGetTicketAttachments };
};

describe('getTicketAttachments', () => {
	test('routes the call through Jira when the discriminant is jira', async () => {
		const { mockLinearGetTicketAttachments, mockJiraGetTicketAttachments } = setup();
		const settings = jiraTrackerSettingsFixture();

		await getTicketAttachments({ settings, identifier: 'LO-1' });

		expect(mockJiraGetTicketAttachments).toHaveBeenCalledWith({ settings, identifier: 'LO-1' });
		expect(mockLinearGetTicketAttachments).not.toHaveBeenCalled();
	});
});
