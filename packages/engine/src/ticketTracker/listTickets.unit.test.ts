import { describe, expect, jest, test } from '@jest/globals';
import { listTickets as jiraListTickets } from '#src/ticketTracker/jira/listTickets.ts';
import { listTickets as linearListTickets } from '#src/ticketTracker/linear/listTickets.ts';
import { listTickets } from '#src/ticketTracker/listTickets.ts';
import { jiraTrackerSettingsFixture } from '#tests/helpers/jiraQueueSettingsFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// Both provider adapters are doubled: what this file owns is which of the two a
// call reaches and with what, never what either one does. Each double is typed
// off the adapter it stands in for, so a signature that changes on one side
// fails here rather than at the first call that trusted the stub.
jest.mock('#src/ticketTracker/linear/listTickets.ts', () => ({ listTickets: jest.fn<typeof linearListTickets>() }));
jest.mock('#src/ticketTracker/jira/listTickets.ts', () => ({ listTickets: jest.fn<typeof jiraListTickets>() }));
// -------------------------

/** Both adapters answering successfully, so every test states only the answer it cares about. */
const setup = () => {
	const mockLinearListTickets = jest.mocked(linearListTickets);
	const mockJiraListTickets = jest.mocked(jiraListTickets);

	mockLinearListTickets.mockResolvedValue([]);
	mockJiraListTickets.mockResolvedValue([]);

	return { mockLinearListTickets, mockJiraListTickets };
};

describe('listTickets', () => {
	test('routes the call through Jira when the discriminant is jira', async () => {
		const { mockLinearListTickets, mockJiraListTickets } = setup();
		const settings = jiraTrackerSettingsFixture();

		await listTickets({ settings, labelNames: ['route-direct'], statuses: ['Ready'] });

		expect(mockJiraListTickets).toHaveBeenCalledWith({ settings, labelNames: ['route-direct'], statuses: ['Ready'] });
		expect(mockLinearListTickets).not.toHaveBeenCalled();
	});

	test('routes Linear settings to the Linear adapter', async () => {
		const { mockLinearListTickets, mockJiraListTickets } = setup();
		const settings = trackerSettingsFixture();

		await listTickets({ settings, labelNames: ['route-direct'], statuses: ['Ready'] });

		expect(mockLinearListTickets).toHaveBeenCalledWith({ settings, labelNames: ['route-direct'], statuses: ['Ready'] });
		expect(mockJiraListTickets).not.toHaveBeenCalled();
	});
});
