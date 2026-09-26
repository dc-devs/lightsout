import { describe, expect, jest, test } from '@jest/globals';
import { setTicketAttachment as jiraSetTicketAttachment } from '#src/ticketTracker/jira/setTicketAttachment.ts';
import { setTicketAttachment as linearSetTicketAttachment } from '#src/ticketTracker/linear/setTicketAttachment.ts';
import { setTicketAttachment } from '#src/ticketTracker/setTicketAttachment.ts';
import { jiraTrackerSettingsFixture } from '#tests/helpers/jiraQueueSettingsFixture.ts';

// Mocked Imports
// -------------------------
// Both provider adapters are doubled: what this file owns is which of the two a
// call reaches and with what, never what either one does. Each double is typed
// off the adapter it stands in for, so a signature that changes on one side
// fails here rather than at the first call that trusted the stub.
jest.mock('#src/ticketTracker/linear/setTicketAttachment.ts', () => ({ setTicketAttachment: jest.fn<typeof linearSetTicketAttachment>() }));
jest.mock('#src/ticketTracker/jira/setTicketAttachment.ts', () => ({ setTicketAttachment: jest.fn<typeof jiraSetTicketAttachment>() }));
// -------------------------

/** Both adapters answering successfully, so every test states only the answer it cares about. */
const setup = () => {
	const mockLinearSetTicketAttachment = jest.mocked(linearSetTicketAttachment);
	const mockJiraSetTicketAttachment = jest.mocked(jiraSetTicketAttachment);

	mockLinearSetTicketAttachment.mockResolvedValue(undefined);
	mockJiraSetTicketAttachment.mockResolvedValue(undefined);

	return { mockLinearSetTicketAttachment, mockJiraSetTicketAttachment };
};

describe('setTicketAttachment', () => {
	test('routes the call through Jira when the discriminant is jira', async () => {
		const { mockLinearSetTicketAttachment, mockJiraSetTicketAttachment } = setup();
		const settings = jiraTrackerSettingsFixture();
		const content = Buffer.from('plan');

		await setTicketAttachment({ settings, ticketId: '1001', title: 'plan.md', content, contentType: 'text/markdown' });

		expect(mockJiraSetTicketAttachment).toHaveBeenCalledWith({ settings, ticketId: '1001', title: 'plan.md', content, contentType: 'text/markdown' });
		expect(mockLinearSetTicketAttachment).not.toHaveBeenCalled();
	});
});
