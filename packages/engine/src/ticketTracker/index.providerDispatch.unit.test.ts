import { describe, expect, jest, test } from '@jest/globals';
import { appendTicketNote } from '#src/ticketTracker/appendTicketNote.ts';
import { getTicketAttachments } from '#src/ticketTracker/getTicketAttachments.ts';
import { getTicketsByIdentifiers } from '#src/ticketTracker/getTicketsByIdentifiers.ts';
import { appendTicketNote as jiraAppendTicketNote } from '#src/ticketTracker/jira/appendTicketNote.ts';
import { getTicketAttachments as jiraGetTicketAttachments } from '#src/ticketTracker/jira/getTicketAttachments.ts';
import { getTicketsByIdentifiers as jiraGetTicketsByIdentifiers } from '#src/ticketTracker/jira/getTicketsByIdentifiers.ts';
import { listLabelNames as jiraListLabelNames } from '#src/ticketTracker/jira/listLabelNames.ts';
import { listTickets as jiraListTickets } from '#src/ticketTracker/jira/listTickets.ts';
import { readTicketAsset as jiraReadTicketAsset } from '#src/ticketTracker/jira/readTicketAsset.ts';
import { setExclusiveLabel as jiraSetExclusiveLabel } from '#src/ticketTracker/jira/setExclusiveLabel.ts';
import { setTicketAttachment as jiraSetTicketAttachment } from '#src/ticketTracker/jira/setTicketAttachment.ts';
import { setTicketLabel as jiraSetTicketLabel } from '#src/ticketTracker/jira/setTicketLabel.ts';
import { setTicketStatus as jiraSetTicketStatus } from '#src/ticketTracker/jira/setTicketStatus.ts';
import { appendTicketNote as linearAppendTicketNote } from '#src/ticketTracker/linear/appendTicketNote.ts';
import { getTicketAttachments as linearGetTicketAttachments } from '#src/ticketTracker/linear/getTicketAttachments.ts';
import { getTicketsByIdentifiers as linearGetTicketsByIdentifiers } from '#src/ticketTracker/linear/getTicketsByIdentifiers.ts';
import { listLabelNames as linearListLabelNames } from '#src/ticketTracker/linear/listLabelNames.ts';
import { listTickets as linearListTickets } from '#src/ticketTracker/linear/listTickets.ts';
import { readTicketAsset as linearReadTicketAsset } from '#src/ticketTracker/linear/readTicketAsset.ts';
import { setExclusiveLabel as linearSetExclusiveLabel } from '#src/ticketTracker/linear/setExclusiveLabel.ts';
import { setTicketAttachment as linearSetTicketAttachment } from '#src/ticketTracker/linear/setTicketAttachment.ts';
import { setTicketLabel as linearSetTicketLabel } from '#src/ticketTracker/linear/setTicketLabel.ts';
import { setTicketStatus as linearSetTicketStatus } from '#src/ticketTracker/linear/setTicketStatus.ts';
import { listLabelNames } from '#src/ticketTracker/listLabelNames.ts';
import { listTickets } from '#src/ticketTracker/listTickets.ts';
import { readTicketAsset } from '#src/ticketTracker/readTicketAsset.ts';
import { setExclusiveLabel } from '#src/ticketTracker/setExclusiveLabel.ts';
import { setTicketAttachment } from '#src/ticketTracker/setTicketAttachment.ts';
import { setTicketLabel } from '#src/ticketTracker/setTicketLabel.ts';
import { setTicketStatus } from '#src/ticketTracker/setTicketStatus.ts';
import { jiraTrackerSettingsFixture } from '#tests/helpers/jiraQueueSettingsFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// Both provider adapters are doubled whole: what this file owns is which of the
// two a seam call reaches and with what, never what either one does. Each double
// is typed off the adapter it stands in for, so a signature that changes on one
// side fails here rather than at the first call that trusted the stub.
const linearAdapter = {
	appendTicketNote: linearAppendTicketNote,
	getTicketAttachments: linearGetTicketAttachments,
	getTicketsByIdentifiers: linearGetTicketsByIdentifiers,
	listLabelNames: linearListLabelNames,
	listTickets: linearListTickets,
	readTicketAsset: linearReadTicketAsset,
	setExclusiveLabel: linearSetExclusiveLabel,
	setTicketAttachment: linearSetTicketAttachment,
	setTicketLabel: linearSetTicketLabel,
	setTicketStatus: linearSetTicketStatus,
};
const jiraAdapter = {
	appendTicketNote: jiraAppendTicketNote,
	getTicketAttachments: jiraGetTicketAttachments,
	getTicketsByIdentifiers: jiraGetTicketsByIdentifiers,
	listLabelNames: jiraListLabelNames,
	listTickets: jiraListTickets,
	readTicketAsset: jiraReadTicketAsset,
	setExclusiveLabel: jiraSetExclusiveLabel,
	setTicketAttachment: jiraSetTicketAttachment,
	setTicketLabel: jiraSetTicketLabel,
	setTicketStatus: jiraSetTicketStatus,
};

type LinearAdapter = typeof linearAdapter;
type JiraAdapter = typeof jiraAdapter;

jest.mock('#src/ticketTracker/linear/appendTicketNote.ts', () => ({ appendTicketNote: jest.fn<LinearAdapter['appendTicketNote']>() }));
jest.mock('#src/ticketTracker/linear/getTicketAttachments.ts', () => ({ getTicketAttachments: jest.fn<LinearAdapter['getTicketAttachments']>() }));
jest.mock('#src/ticketTracker/linear/getTicketsByIdentifiers.ts', () => ({
	getTicketsByIdentifiers: jest.fn<LinearAdapter['getTicketsByIdentifiers']>(),
}));
jest.mock('#src/ticketTracker/linear/listLabelNames.ts', () => ({ listLabelNames: jest.fn<LinearAdapter['listLabelNames']>() }));
jest.mock('#src/ticketTracker/linear/listTickets.ts', () => ({ listTickets: jest.fn<LinearAdapter['listTickets']>() }));
jest.mock('#src/ticketTracker/linear/readTicketAsset.ts', () => ({ readTicketAsset: jest.fn<LinearAdapter['readTicketAsset']>() }));
jest.mock('#src/ticketTracker/linear/setExclusiveLabel.ts', () => ({ setExclusiveLabel: jest.fn<LinearAdapter['setExclusiveLabel']>() }));
jest.mock('#src/ticketTracker/linear/setTicketAttachment.ts', () => ({ setTicketAttachment: jest.fn<LinearAdapter['setTicketAttachment']>() }));
jest.mock('#src/ticketTracker/linear/setTicketLabel.ts', () => ({ setTicketLabel: jest.fn<LinearAdapter['setTicketLabel']>() }));
jest.mock('#src/ticketTracker/linear/setTicketStatus.ts', () => ({ setTicketStatus: jest.fn<LinearAdapter['setTicketStatus']>() }));
jest.mock('#src/ticketTracker/jira/appendTicketNote.ts', () => ({ appendTicketNote: jest.fn<JiraAdapter['appendTicketNote']>() }));
jest.mock('#src/ticketTracker/jira/getTicketAttachments.ts', () => ({ getTicketAttachments: jest.fn<JiraAdapter['getTicketAttachments']>() }));
jest.mock('#src/ticketTracker/jira/getTicketsByIdentifiers.ts', () => ({
	getTicketsByIdentifiers: jest.fn<JiraAdapter['getTicketsByIdentifiers']>(),
}));
jest.mock('#src/ticketTracker/jira/listLabelNames.ts', () => ({ listLabelNames: jest.fn<JiraAdapter['listLabelNames']>() }));
jest.mock('#src/ticketTracker/jira/listTickets.ts', () => ({ listTickets: jest.fn<JiraAdapter['listTickets']>() }));
jest.mock('#src/ticketTracker/jira/readTicketAsset.ts', () => ({ readTicketAsset: jest.fn<JiraAdapter['readTicketAsset']>() }));
jest.mock('#src/ticketTracker/jira/setExclusiveLabel.ts', () => ({ setExclusiveLabel: jest.fn<JiraAdapter['setExclusiveLabel']>() }));
jest.mock('#src/ticketTracker/jira/setTicketAttachment.ts', () => ({ setTicketAttachment: jest.fn<JiraAdapter['setTicketAttachment']>() }));
jest.mock('#src/ticketTracker/jira/setTicketLabel.ts', () => ({ setTicketLabel: jest.fn<JiraAdapter['setTicketLabel']>() }));
jest.mock('#src/ticketTracker/jira/setTicketStatus.ts', () => ({ setTicketStatus: jest.fn<JiraAdapter['setTicketStatus']>() }));
// -------------------------

/** Both adapters answering successfully, so every test states only the answer it cares about. */
const setup = () => {
	const mockLinearAdapter = jest.mocked(linearAdapter);
	const mockJiraAdapter = jest.mocked(jiraAdapter);

	for (const adapter of [mockLinearAdapter, mockJiraAdapter]) {
		adapter.appendTicketNote.mockResolvedValue(undefined);
		adapter.getTicketAttachments.mockResolvedValue([]);
		adapter.getTicketsByIdentifiers.mockResolvedValue([]);
		adapter.listLabelNames.mockResolvedValue([]);
		adapter.listTickets.mockResolvedValue([]);
		adapter.readTicketAsset.mockResolvedValue('body');
		adapter.setExclusiveLabel.mockResolvedValue(undefined);
		adapter.setTicketAttachment.mockResolvedValue(undefined);
		adapter.setTicketLabel.mockResolvedValue(undefined);
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
		await setTicketLabel({ settings, ticketId: '1001', label: 'parked', present: true });
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
		expect(mockJiraAdapter.setTicketLabel).toHaveBeenCalledWith({ settings, ticketId: '1001', label: 'parked', present: true });
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

	test('setTicketLabel dispatches by provider with the present flag', async () => {
		const { mockLinearAdapter, mockJiraAdapter } = setup();
		const linearSettings = trackerSettingsFixture();
		const jiraSettings = jiraTrackerSettingsFixture();

		await setTicketLabel({ settings: linearSettings, ticketId: '1001', label: 'queue-blocked-gate-timed-out', present: true });
		await setTicketLabel({ settings: jiraSettings, ticketId: '2002', label: 'queue-blocked-gate-timed-out', present: false });

		expect(mockLinearAdapter.setTicketLabel).toHaveBeenCalledWith({
			settings: linearSettings,
			ticketId: '1001',
			label: 'queue-blocked-gate-timed-out',
			present: true,
		});
		expect(mockJiraAdapter.setTicketLabel).toHaveBeenCalledWith({
			settings: jiraSettings,
			ticketId: '2002',
			label: 'queue-blocked-gate-timed-out',
			present: false,
		});
		expect(mockLinearAdapter.setTicketLabel).toHaveBeenCalledTimes(1);
		expect(mockJiraAdapter.setTicketLabel).toHaveBeenCalledTimes(1);
	});

	test('answers the failure its provider answered when a ticket label write fails', async () => {
		const { mockLinearAdapter } = setup();
		const settings = trackerSettingsFixture();

		mockLinearAdapter.setTicketLabel.mockResolvedValue({ error: "the 'LO' team has no 'queue-blocked-gate-timed-out' label" });

		const failure = await setTicketLabel({ settings, ticketId: '1001', label: 'queue-blocked-gate-timed-out', present: true });

		expect(failure).toStrictEqual({ error: "the 'LO' team has no 'queue-blocked-gate-timed-out' label" });
	});

	test('answers undefined when its provider wrote the ticket label', async () => {
		setup();

		const settings = jiraTrackerSettingsFixture();

		const failure = await setTicketLabel({ settings, ticketId: '2002', label: 'queue-blocked-gate-timed-out', present: false });

		expect(failure).toBeUndefined();
	});
});
