import { describe, expect, jest, test } from '@jest/globals';
import {
	appendTicketNote,
	getTicketAttachments,
	getTicketsByIdentifiers,
	listLabelNames,
	listTickets,
	readTicketAsset,
	setExclusiveLabel,
	setParkedLabel,
	setTicketAttachment,
	setTicketStatus,
} from '#src/ticketTracker/index.ts';
import * as mockJiraAdapterModule from '#src/ticketTracker/jira/index.ts';
import * as mockLinearAdapterModule from '#src/ticketTracker/linear/index.ts';
import { jiraTrackerSettingsFixture } from '#tests/helpers/jiraQueueSettingsFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// Both provider adapters are doubled whole: what this file owns is which of the
// two a seam call reaches and with what, never what either one does. Each double
// is typed off the adapter it stands in for, so a signature that changes on one
// side fails here rather than at the first call that trusted the stub.
type LinearAdapter = typeof mockLinearAdapterModule;
type JiraAdapter = typeof mockJiraAdapterModule;

jest.mock('#src/ticketTracker/linear/index.ts', () => ({
	appendTicketNote: jest.fn<LinearAdapter['appendTicketNote']>(),
	getTicketAttachments: jest.fn<LinearAdapter['getTicketAttachments']>(),
	getTicketsByIdentifiers: jest.fn<LinearAdapter['getTicketsByIdentifiers']>(),
	listLabelNames: jest.fn<LinearAdapter['listLabelNames']>(),
	listTickets: jest.fn<LinearAdapter['listTickets']>(),
	readTicketAsset: jest.fn<LinearAdapter['readTicketAsset']>(),
	setExclusiveLabel: jest.fn<LinearAdapter['setExclusiveLabel']>(),
	setParkedLabel: jest.fn<LinearAdapter['setParkedLabel']>(),
	setTicketAttachment: jest.fn<LinearAdapter['setTicketAttachment']>(),
	setTicketStatus: jest.fn<LinearAdapter['setTicketStatus']>(),
}));
jest.mock('#src/ticketTracker/jira/index.ts', () => ({
	appendTicketNote: jest.fn<JiraAdapter['appendTicketNote']>(),
	getTicketAttachments: jest.fn<JiraAdapter['getTicketAttachments']>(),
	getTicketsByIdentifiers: jest.fn<JiraAdapter['getTicketsByIdentifiers']>(),
	listLabelNames: jest.fn<JiraAdapter['listLabelNames']>(),
	listTickets: jest.fn<JiraAdapter['listTickets']>(),
	readTicketAsset: jest.fn<JiraAdapter['readTicketAsset']>(),
	setExclusiveLabel: jest.fn<JiraAdapter['setExclusiveLabel']>(),
	setParkedLabel: jest.fn<JiraAdapter['setParkedLabel']>(),
	setTicketAttachment: jest.fn<JiraAdapter['setTicketAttachment']>(),
	setTicketStatus: jest.fn<JiraAdapter['setTicketStatus']>(),
}));
// -------------------------

/** Both adapters answering successfully, so every test states only the answer it cares about. */
const setup = () => {
	const mockLinearAdapter = jest.mocked(mockLinearAdapterModule);
	const mockJiraAdapter = jest.mocked(mockJiraAdapterModule);

	for (const adapter of [mockLinearAdapter, mockJiraAdapter]) {
		adapter.appendTicketNote.mockResolvedValue(undefined);
		adapter.getTicketAttachments.mockResolvedValue([]);
		adapter.getTicketsByIdentifiers.mockResolvedValue([]);
		adapter.listLabelNames.mockResolvedValue([]);
		adapter.listTickets.mockResolvedValue([]);
		adapter.readTicketAsset.mockResolvedValue('body');
		adapter.setExclusiveLabel.mockResolvedValue(undefined);
		adapter.setParkedLabel.mockResolvedValue(undefined);
		adapter.setTicketAttachment.mockResolvedValue(undefined);
		adapter.setTicketStatus.mockResolvedValue(undefined);
	}

	return { mockLinearAdapter, mockJiraAdapter };
};

describe('tracker provider dispatch', () => {
	test('routes every seam operation through Jira when the discriminant is jira', async () => {
		const { mockLinearAdapter, mockJiraAdapter } = setup();
		const settings = jiraTrackerSettingsFixture();
		const content = Buffer.from('plan');

		await appendTicketNote({ settings, ticketId: '1001', heading: '## Decisions', line: '- yes' });
		await getTicketAttachments({ settings, identifier: 'LO-1' });
		await getTicketsByIdentifiers({ settings, identifiers: ['LO-1'] });
		await listLabelNames({ settings });
		await listTickets({ settings, labelNames: ['route-direct'], statuses: ['Ready'] });
		await readTicketAsset({ settings, url: 'https://example.atlassian.net/rest/api/3/attachment/content/7' });
		await setExclusiveLabel({ settings, ticketId: '1001', label: 'shaped', groupLabels: ['shaped', 'raw'] });
		await setParkedLabel({ settings, ticketId: '1001', label: 'parked', parked: true });
		await setTicketAttachment({ settings, ticketId: '1001', title: 'plan.md', content, contentType: 'text/markdown' });
		await setTicketStatus({ settings, ticketId: '1001', statusName: 'Done' });

		expect(mockJiraAdapter.appendTicketNote).toHaveBeenCalledWith({ settings, ticketId: '1001', heading: '## Decisions', line: '- yes' });
		expect(mockJiraAdapter.getTicketAttachments).toHaveBeenCalledWith({ settings, identifier: 'LO-1' });
		expect(mockJiraAdapter.getTicketsByIdentifiers).toHaveBeenCalledWith({ settings, identifiers: ['LO-1'] });
		expect(mockJiraAdapter.listLabelNames).toHaveBeenCalledWith({ settings });
		expect(mockJiraAdapter.listTickets).toHaveBeenCalledWith({ settings, labelNames: ['route-direct'], statuses: ['Ready'] });
		expect(mockJiraAdapter.readTicketAsset).toHaveBeenCalledWith({
			settings,
			url: 'https://example.atlassian.net/rest/api/3/attachment/content/7',
		});
		expect(mockJiraAdapter.setExclusiveLabel).toHaveBeenCalledWith({ settings, ticketId: '1001', label: 'shaped', groupLabels: ['shaped', 'raw'] });
		expect(mockJiraAdapter.setParkedLabel).toHaveBeenCalledWith({ settings, ticketId: '1001', label: 'parked', parked: true });
		expect(mockJiraAdapter.setTicketAttachment).toHaveBeenCalledWith({ settings, ticketId: '1001', title: 'plan.md', content, contentType: 'text/markdown' });
		expect(mockJiraAdapter.setTicketStatus).toHaveBeenCalledWith({ settings, ticketId: '1001', statusName: 'Done' });
		expect(mockLinearAdapter.listTickets).not.toHaveBeenCalled();
	});

	test('routes Linear settings to the Linear adapter', async () => {
		const { mockLinearAdapter, mockJiraAdapter } = setup();
		const settings = trackerSettingsFixture();

		await listTickets({ settings, labelNames: ['route-direct'], statuses: ['Ready'] });

		expect(mockLinearAdapter.listTickets).toHaveBeenCalledWith({ settings, labelNames: ['route-direct'], statuses: ['Ready'] });
		expect(mockJiraAdapter.listTickets).not.toHaveBeenCalled();
	});

	test('answers the Linear label catalog with the names that provider returned', async () => {
		const { mockLinearAdapter, mockJiraAdapter } = setup();
		const settings = trackerSettingsFixture();

		mockLinearAdapter.listLabelNames.mockResolvedValue(['shaped', 'raw', 'parked']);

		const labelNames = await listLabelNames({ settings });

		expect(mockLinearAdapter.listLabelNames).toHaveBeenCalledWith({ settings });
		expect(mockJiraAdapter.listLabelNames).not.toHaveBeenCalled();
		expect(labelNames).toStrictEqual(['shaped', 'raw', 'parked']);
	});

	test('answers the Jira label catalog with the names that provider returned', async () => {
		const { mockJiraAdapter } = setup();
		const settings = jiraTrackerSettingsFixture();

		mockJiraAdapter.listLabelNames.mockResolvedValue(['shaped', 'raw']);

		const labelNames = await listLabelNames({ settings });

		expect(labelNames).toStrictEqual(['shaped', 'raw']);
	});

	test('answers the label catalog failure the provider returned rather than an empty catalog', async () => {
		const { mockJiraAdapter } = setup();
		const settings = jiraTrackerSettingsFixture();

		mockJiraAdapter.listLabelNames.mockResolvedValue({ error: 'Jira returned a nonfinal label page with no values' });

		const labelNames = await listLabelNames({ settings });

		expect(labelNames).toStrictEqual({ error: 'Jira returned a nonfinal label page with no values' });
	});

	test('routes an exclusive label write through Linear when the discriminant is linear', async () => {
		const { mockLinearAdapter, mockJiraAdapter } = setup();
		const settings = trackerSettingsFixture();

		await setExclusiveLabel({ settings, ticketId: '1001', label: 'shaped', groupLabels: ['shaped', 'raw'] });

		expect(mockLinearAdapter.setExclusiveLabel).toHaveBeenCalledWith({ settings, ticketId: '1001', label: 'shaped', groupLabels: ['shaped', 'raw'] });
		expect(mockJiraAdapter.setExclusiveLabel).not.toHaveBeenCalled();
	});

	test('answers the failure its provider answered when an exclusive label write fails', async () => {
		const { mockLinearAdapter } = setup();
		const settings = trackerSettingsFixture();

		mockLinearAdapter.setExclusiveLabel.mockResolvedValue({ error: "the 'LO' team has no 'shaped' label" });

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
