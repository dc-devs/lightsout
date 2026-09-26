import { describe, expect, jest, test } from '@jest/globals';
import { listLabelNames as jiraListLabelNames } from '#src/ticketTracker/jira/listLabelNames.ts';
import { listLabelNames as linearListLabelNames } from '#src/ticketTracker/linear/listLabelNames.ts';
import { listLabelNames } from '#src/ticketTracker/listLabelNames.ts';
import { jiraTrackerSettingsFixture } from '#tests/helpers/jiraQueueSettingsFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// Both provider adapters are doubled: what this file owns is which of the two a
// call reaches and with what, never what either one does. Each double is typed
// off the adapter it stands in for, so a signature that changes on one side
// fails here rather than at the first call that trusted the stub.
jest.mock('#src/ticketTracker/linear/listLabelNames.ts', () => ({ listLabelNames: jest.fn<typeof linearListLabelNames>() }));
jest.mock('#src/ticketTracker/jira/listLabelNames.ts', () => ({ listLabelNames: jest.fn<typeof jiraListLabelNames>() }));
// -------------------------

/** Both adapters answering successfully, so every test states only the answer it cares about. */
const setup = () => {
	const mockLinearListLabelNames = jest.mocked(linearListLabelNames);
	const mockJiraListLabelNames = jest.mocked(jiraListLabelNames);

	mockLinearListLabelNames.mockResolvedValue([]);
	mockJiraListLabelNames.mockResolvedValue([]);

	return { mockLinearListLabelNames, mockJiraListLabelNames };
};

describe('listLabelNames', () => {
	test('routes the call through Jira when the discriminant is jira', async () => {
		const { mockLinearListLabelNames, mockJiraListLabelNames } = setup();
		const settings = jiraTrackerSettingsFixture();

		await listLabelNames({ settings });

		expect(mockJiraListLabelNames).toHaveBeenCalledWith({ settings });
		expect(mockLinearListLabelNames).not.toHaveBeenCalled();
	});

	test('answers the Linear label catalog with the names that provider returned', async () => {
		const { mockLinearListLabelNames, mockJiraListLabelNames } = setup();
		const settings = trackerSettingsFixture();

		mockLinearListLabelNames.mockResolvedValue(['shaped', 'raw', 'parked']);

		const labelNames = await listLabelNames({ settings });

		expect(mockLinearListLabelNames).toHaveBeenCalledWith({ settings });
		expect(mockJiraListLabelNames).not.toHaveBeenCalled();
		expect(labelNames).toStrictEqual(['shaped', 'raw', 'parked']);
	});

	test('answers the Jira label catalog with the names that provider returned', async () => {
		const { mockJiraListLabelNames } = setup();
		const settings = jiraTrackerSettingsFixture();

		mockJiraListLabelNames.mockResolvedValue(['shaped', 'raw']);

		const labelNames = await listLabelNames({ settings });

		expect(labelNames).toStrictEqual(['shaped', 'raw']);
	});

	test('answers the label catalog failure the provider returned rather than an empty catalog', async () => {
		const { mockJiraListLabelNames } = setup();
		const settings = jiraTrackerSettingsFixture();

		mockJiraListLabelNames.mockResolvedValue({ error: 'Jira returned a nonfinal label page with no values' });

		const labelNames = await listLabelNames({ settings });

		expect(labelNames).toStrictEqual({ error: 'Jira returned a nonfinal label page with no values' });
	});
});
