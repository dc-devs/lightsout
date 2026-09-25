import { describe, expect, jest, test } from '@jest/globals';
import { appendTicketNote } from '#src/ticketTracker/appendTicketNote.ts';
import { appendTicketNote as jiraAppendTicketNote } from '#src/ticketTracker/jira/appendTicketNote.ts';
import { appendTicketNote as linearAppendTicketNote } from '#src/ticketTracker/linear/appendTicketNote.ts';
import { jiraTrackerSettingsFixture } from '#tests/helpers/jiraQueueSettingsFixture.ts';

// Mocked Imports
// -------------------------
// Both provider adapters are doubled: what this file owns is which of the two a
// call reaches and with what, never what either one does. Each double is typed
// off the adapter it stands in for, so a signature that changes on one side
// fails here rather than at the first call that trusted the stub.
jest.mock('#src/ticketTracker/linear/appendTicketNote.ts', () => ({ appendTicketNote: jest.fn<typeof linearAppendTicketNote>() }));
jest.mock('#src/ticketTracker/jira/appendTicketNote.ts', () => ({ appendTicketNote: jest.fn<typeof jiraAppendTicketNote>() }));
// -------------------------

/** Both adapters answering successfully, so every test states only the answer it cares about. */
const setup = () => {
	const mockLinearAppendTicketNote = jest.mocked(linearAppendTicketNote);
	const mockJiraAppendTicketNote = jest.mocked(jiraAppendTicketNote);

	mockLinearAppendTicketNote.mockResolvedValue(undefined);
	mockJiraAppendTicketNote.mockResolvedValue(undefined);

	return { mockLinearAppendTicketNote, mockJiraAppendTicketNote };
};

describe('appendTicketNote', () => {
	test('routes the call through Jira when the discriminant is jira', async () => {
		const { mockLinearAppendTicketNote, mockJiraAppendTicketNote } = setup();
		const settings = jiraTrackerSettingsFixture();

		await appendTicketNote({ settings, ticketId: '1001', heading: '## Decisions', line: '- yes' });

		expect(mockJiraAppendTicketNote).toHaveBeenCalledWith({ settings, ticketId: '1001', heading: '## Decisions', line: '- yes' });
		expect(mockLinearAppendTicketNote).not.toHaveBeenCalled();
	});
});
