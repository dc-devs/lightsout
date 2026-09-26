import { describe, expect, jest, test } from '@jest/globals';
import { setExclusiveLabel as jiraSetExclusiveLabel } from '#src/ticketTracker/jira/setExclusiveLabel.ts';
import { setExclusiveLabel as linearSetExclusiveLabel } from '#src/ticketTracker/linear/setExclusiveLabel.ts';
import { setExclusiveLabel } from '#src/ticketTracker/setExclusiveLabel.ts';
import { jiraTrackerSettingsFixture } from '#tests/helpers/jiraQueueSettingsFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// Both provider adapters are doubled: what this file owns is which of the two a
// call reaches and with what, never what either one does. Each double is typed
// off the adapter it stands in for, so a signature that changes on one side
// fails here rather than at the first call that trusted the stub.
jest.mock('#src/ticketTracker/linear/setExclusiveLabel.ts', () => ({ setExclusiveLabel: jest.fn<typeof linearSetExclusiveLabel>() }));
jest.mock('#src/ticketTracker/jira/setExclusiveLabel.ts', () => ({ setExclusiveLabel: jest.fn<typeof jiraSetExclusiveLabel>() }));
// -------------------------

/** Both adapters answering successfully, so every test states only the answer it cares about. */
const setup = () => {
	const mockLinearSetExclusiveLabel = jest.mocked(linearSetExclusiveLabel);
	const mockJiraSetExclusiveLabel = jest.mocked(jiraSetExclusiveLabel);

	mockLinearSetExclusiveLabel.mockResolvedValue(undefined);
	mockJiraSetExclusiveLabel.mockResolvedValue(undefined);

	return { mockLinearSetExclusiveLabel, mockJiraSetExclusiveLabel };
};

describe('setExclusiveLabel', () => {
	test('routes the call through Jira when the discriminant is jira', async () => {
		const { mockLinearSetExclusiveLabel, mockJiraSetExclusiveLabel } = setup();
		const settings = jiraTrackerSettingsFixture();

		await setExclusiveLabel({ settings, ticketId: '1001', label: 'shaped', groupLabels: ['shaped', 'raw'] });

		expect(mockJiraSetExclusiveLabel).toHaveBeenCalledWith({ settings, ticketId: '1001', label: 'shaped', groupLabels: ['shaped', 'raw'] });
		expect(mockLinearSetExclusiveLabel).not.toHaveBeenCalled();
	});

	test('routes an exclusive label write through Linear when the discriminant is linear', async () => {
		const { mockLinearSetExclusiveLabel, mockJiraSetExclusiveLabel } = setup();
		const settings = trackerSettingsFixture();

		await setExclusiveLabel({ settings, ticketId: '1001', label: 'shaped', groupLabels: ['shaped', 'raw'] });

		expect(mockLinearSetExclusiveLabel).toHaveBeenCalledWith({ settings, ticketId: '1001', label: 'shaped', groupLabels: ['shaped', 'raw'] });
		expect(mockJiraSetExclusiveLabel).not.toHaveBeenCalled();
	});

	test('answers the failure its provider answered when an exclusive label write fails', async () => {
		const { mockLinearSetExclusiveLabel } = setup();
		const settings = trackerSettingsFixture();

		mockLinearSetExclusiveLabel.mockResolvedValue({ error: "the 'LO' team has no 'shaped' label" });

		const failure = await setExclusiveLabel({ settings, ticketId: '1001', label: 'shaped', groupLabels: ['shaped', 'raw'] });

		expect(failure).toStrictEqual({ error: "the 'LO' team has no 'shaped' label" });
	});

	test('answers undefined when its provider wrote the exclusive label', async () => {
		setup();

		const settings = jiraTrackerSettingsFixture();

		const failure = await setExclusiveLabel({ settings, ticketId: '1001', label: 'shaped', groupLabels: ['shaped', 'raw'] });

		expect(failure).toBeUndefined();
	});
});
