import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import {
	appendTicketNote,
	getTicketAttachments,
	getTicketsByIdentifiers,
	listTickets,
	readTicketAsset,
	setParkedLabel,
	setTicketAttachment,
	setTicketStatus,
} from '#src/ticketTracker/index.ts';
import * as mockJiraAdapterModule from '#src/ticketTracker/jira/index.ts';
import * as mockLinearAdapterModule from '#src/ticketTracker/linear/index.ts';
import { jiraTrackerSettingsFixture } from '#tests/helpers/jiraQueueSettingsFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

jest.mock('#src/ticketTracker/linear/index.ts', () => ({
	appendTicketNote: jest.fn(),
	getTicketAttachments: jest.fn(),
	getTicketsByIdentifiers: jest.fn(),
	listTickets: jest.fn(),
	readTicketAsset: jest.fn(),
	setParkedLabel: jest.fn(),
	setTicketAttachment: jest.fn(),
	setTicketStatus: jest.fn(),
}));
jest.mock('#src/ticketTracker/jira/index.ts', () => ({
	appendTicketNote: jest.fn(),
	getTicketAttachments: jest.fn(),
	getTicketsByIdentifiers: jest.fn(),
	listTickets: jest.fn(),
	readTicketAsset: jest.fn(),
	setParkedLabel: jest.fn(),
	setTicketAttachment: jest.fn(),
	setTicketStatus: jest.fn(),
}));

const mockLinearAdapter = jest.mocked(mockLinearAdapterModule);
const mockJiraAdapter = jest.mocked(mockJiraAdapterModule);

beforeEach(() => {
	jest.clearAllMocks();

	for (const adapter of [mockLinearAdapter, mockJiraAdapter]) {
		adapter.appendTicketNote.mockResolvedValue(undefined);
		adapter.getTicketAttachments.mockResolvedValue([]);
		adapter.getTicketsByIdentifiers.mockResolvedValue([]);
		adapter.listTickets.mockResolvedValue([]);
		adapter.readTicketAsset.mockResolvedValue('body');
		adapter.setParkedLabel.mockResolvedValue(undefined);
		adapter.setTicketAttachment.mockResolvedValue(undefined);
		adapter.setTicketStatus.mockResolvedValue(undefined);
	}
});

describe('tracker provider dispatch', () => {
	test('routes every seam operation through Jira when the discriminant is jira', async () => {
		const settings = jiraTrackerSettingsFixture();
		const content = Buffer.from('plan');

		await appendTicketNote({ settings, ticketId: '1001', heading: '## Decisions', line: '- yes' });
		await getTicketAttachments({ settings, identifier: 'LO-1' });
		await getTicketsByIdentifiers({ settings, identifiers: ['LO-1'] });
		await listTickets({ settings, labelNames: ['route-direct'], statuses: ['Ready'] });
		await readTicketAsset({ settings, url: 'https://example.atlassian.net/rest/api/3/attachment/content/7' });
		await setParkedLabel({ settings, ticketId: '1001', label: 'parked', parked: true });
		await setTicketAttachment({ settings, ticketId: '1001', title: 'plan.md', content, contentType: 'text/markdown' });
		await setTicketStatus({ settings, ticketId: '1001', statusName: 'Done' });

		expect(mockJiraAdapter.appendTicketNote).toHaveBeenCalledWith({ settings, ticketId: '1001', heading: '## Decisions', line: '- yes' });
		expect(mockJiraAdapter.getTicketAttachments).toHaveBeenCalledWith({ settings, identifier: 'LO-1' });
		expect(mockJiraAdapter.getTicketsByIdentifiers).toHaveBeenCalledWith({ settings, identifiers: ['LO-1'] });
		expect(mockJiraAdapter.listTickets).toHaveBeenCalledWith({ settings, labelNames: ['route-direct'], statuses: ['Ready'] });
		expect(mockJiraAdapter.readTicketAsset).toHaveBeenCalledWith({
			settings,
			url: 'https://example.atlassian.net/rest/api/3/attachment/content/7',
		});
		expect(mockJiraAdapter.setParkedLabel).toHaveBeenCalledWith({ settings, ticketId: '1001', label: 'parked', parked: true });
		expect(mockJiraAdapter.setTicketAttachment).toHaveBeenCalledWith({ settings, ticketId: '1001', title: 'plan.md', content, contentType: 'text/markdown' });
		expect(mockJiraAdapter.setTicketStatus).toHaveBeenCalledWith({ settings, ticketId: '1001', statusName: 'Done' });
		expect(mockLinearAdapter.listTickets).not.toHaveBeenCalled();
	});

	test('routes Linear settings to the Linear adapter', async () => {
		const settings = trackerSettingsFixture();

		await listTickets({ settings, labelNames: ['route-direct'], statuses: ['Ready'] });

		expect(mockLinearAdapter.listTickets).toHaveBeenCalledWith({ settings, labelNames: ['route-direct'], statuses: ['Ready'] });
		expect(mockJiraAdapter.listTickets).not.toHaveBeenCalled();
	});
});
