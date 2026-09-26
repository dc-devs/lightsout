import { describe, expect, jest, test } from '@jest/globals';
import { readTicketAsset as jiraReadTicketAsset } from '#src/ticketTracker/jira/readTicketAsset.ts';
import { readTicketAsset as linearReadTicketAsset } from '#src/ticketTracker/linear/readTicketAsset.ts';
import { readTicketAsset } from '#src/ticketTracker/readTicketAsset.ts';
import { jiraTrackerSettingsFixture } from '#tests/helpers/jiraQueueSettingsFixture.ts';

// Mocked Imports
// -------------------------
// Both provider adapters are doubled: what this file owns is which of the two a
// call reaches and with what, never what either one does. Each double is typed
// off the adapter it stands in for, so a signature that changes on one side
// fails here rather than at the first call that trusted the stub.
jest.mock('#src/ticketTracker/linear/readTicketAsset.ts', () => ({ readTicketAsset: jest.fn<typeof linearReadTicketAsset>() }));
jest.mock('#src/ticketTracker/jira/readTicketAsset.ts', () => ({ readTicketAsset: jest.fn<typeof jiraReadTicketAsset>() }));
// -------------------------

/** Both adapters answering successfully, so every test states only the answer it cares about. */
const setup = () => {
	const mockLinearReadTicketAsset = jest.mocked(linearReadTicketAsset);
	const mockJiraReadTicketAsset = jest.mocked(jiraReadTicketAsset);

	mockLinearReadTicketAsset.mockResolvedValue('body');
	mockJiraReadTicketAsset.mockResolvedValue('body');

	return { mockLinearReadTicketAsset, mockJiraReadTicketAsset };
};

describe('readTicketAsset', () => {
	test('routes the call through Jira when the discriminant is jira', async () => {
		const { mockLinearReadTicketAsset, mockJiraReadTicketAsset } = setup();
		const settings = jiraTrackerSettingsFixture();

		await readTicketAsset({ settings, url: 'https://example.atlassian.net/rest/api/3/attachment/content/7' });

		expect(mockJiraReadTicketAsset).toHaveBeenCalledWith({ settings, url: 'https://example.atlassian.net/rest/api/3/attachment/content/7' });
		expect(mockLinearReadTicketAsset).not.toHaveBeenCalled();
	});
});
