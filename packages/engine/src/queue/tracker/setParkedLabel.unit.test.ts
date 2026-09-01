import { describe, expect, jest, test } from '@jest/globals';
import type { QueueFailure, QueueSettings } from '#src/queue/index.ts';
import { setParkedLabel } from '#src/queue/tracker/index.ts';
import { jiraQueueSettingsFixture } from '#tests/helpers/jiraQueueSettingsFixture.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';

// Mocked Imports
// -------------------------
// `runLinear` is the one place a call leaves the machine; stubbing it pins the
// calls this write makes, and what it does when the label does not exist yet.
type LinearCall = (client: unknown) => Promise<unknown>;

const mockRunLinear = jest.fn<(params: { apiKey: string; call: LinearCall }) => Promise<unknown>>();

jest.mock('#src/queue/tracker/runLinear.ts', () => ({ runLinear: (params: { apiKey: string; call: LinearCall }) => mockRunLinear(params) }));
// -------------------------
type JiraQueueSettings = Extract<QueueSettings, { tracker: 'jira' }>;
type JiraSetParkedLabel = (params: { settings: JiraQueueSettings; ticketId: string; parked: boolean }) => Promise<QueueFailure | undefined>;

const mockSetJiraParkedLabel = jest.fn<JiraSetParkedLabel>();

jest.mock('#src/queue/tracker/jira/index.ts', () => ({
	setParkedLabel: (params: { settings: JiraQueueSettings; ticketId: string; parked: boolean }) => mockSetJiraParkedLabel(params),
}));
// -------------------------

/** A tracker holding these labels and teams, recording every write it is asked for. */
const setupClient = ({
	labels,
	teams = [{ id: 'team-lo' }],
	namesCreatedLabel = true,
}: {
	labels: { id: string }[];
	teams?: { id: string }[];
	namesCreatedLabel?: boolean;
}) => {
	const labelFilters: unknown[] = [];
	const created: unknown[] = [];
	const added: { id: string; labelId: string }[] = [];
	const removed: { id: string; labelId: string }[] = [];

	mockRunLinear.mockImplementation(({ call }) =>
		call({
			issueLabels: (variables: { filter: unknown }) => {
				labelFilters.push(variables.filter);

				return Promise.resolve({ nodes: labels });
			},
			teams: () => Promise.resolve({ nodes: teams }),
			createIssueLabel: (input: unknown) => {
				created.push(input);

				return Promise.resolve({ issueLabelId: namesCreatedLabel ? 'label-new' : undefined });
			},
			issueAddLabel: (id: string, labelId: string) => {
				added.push({ id, labelId });

				return Promise.resolve({ success: true });
			},
			issueRemoveLabel: (id: string, labelId: string) => {
				removed.push({ id, labelId });

				return Promise.resolve({ success: true });
			},
		}),
	);

	return { labelFilters, created, added, removed };
};

const setupJiraLabel = () => {
	const settings = jiraQueueSettingsFixture({ parkedLabel: 'queue-parked' });
	const trackerFailure = { error: 'Jira denied the label update' };
	mockSetJiraParkedLabel.mockResolvedValue(trackerFailure);

	return { settings, trackerFailure };
};

describe('setParkedLabel', () => {
	test('delegates Jira settings and label details to the Jira tracker', async () => {
		const { settings, trackerFailure } = setupJiraLabel();

		const failure = await setParkedLabel({ settings, ticketId: 'LO-84', parked: true });

		expect({ failure, calls: mockSetJiraParkedLabel.mock.calls }).toStrictEqual({
			failure: trackerFailure,
			calls: [[{ settings, ticketId: 'LO-84', parked: true }]],
		});
	});

	test('does nothing at all when the repo named no label — the label is opt-in and must never be invented', async () => {
		expect(await setParkedLabel({ settings: queueSettingsFixture(), ticketId: 'id-70', parked: true })).toBeUndefined();
		expect(mockRunLinear).not.toHaveBeenCalled();
	});

	test('puts the team’s existing label on a ticket that just parked', async () => {
		const { labelFilters, added, created } = setupClient({ labels: [{ id: 'label-1' }] });

		expect(await setParkedLabel({ settings: queueSettingsFixture({ parkedLabel: 'queue-parked' }), ticketId: 'id-70', parked: true })).toBeUndefined();

		expect(labelFilters).toStrictEqual([{ name: { eq: 'queue-parked' }, team: { key: { eq: 'LO' } } }]);
		expect(added).toStrictEqual([{ id: 'id-70', labelId: 'label-1' }]);
		expect(created).toStrictEqual([]);
	});

	test('takes the label off a ticket that resumed or shipped', async () => {
		const { removed } = setupClient({ labels: [{ id: 'label-1' }] });

		await setParkedLabel({ settings: queueSettingsFixture({ parkedLabel: 'queue-parked' }), ticketId: 'id-70', parked: false });

		expect(removed).toStrictEqual([{ id: 'id-70', labelId: 'label-1' }]);
	});

	test('creates the label on the team on first use, so adopting the setting is zero setup', async () => {
		const { created, added } = setupClient({ labels: [] });

		expect(await setParkedLabel({ settings: queueSettingsFixture({ parkedLabel: 'queue-parked' }), ticketId: 'id-70', parked: true })).toBeUndefined();

		expect(created).toStrictEqual([{ name: 'queue-parked', teamId: 'team-lo' }]);
		expect(added).toStrictEqual([{ id: 'id-70', labelId: 'label-new' }]);
	});

	test('creates nothing when clearing a label the team never had — there is nothing to remove', async () => {
		const { created, removed } = setupClient({ labels: [] });

		expect(await setParkedLabel({ settings: queueSettingsFixture({ parkedLabel: 'queue-parked' }), ticketId: 'id-70', parked: false })).toBeUndefined();

		expect(created).toStrictEqual([]);
		expect(removed).toStrictEqual([]);
	});

	test('names the team it cannot create the label on, rather than passing as a silent no-op', async () => {
		const { added } = setupClient({ labels: [], teams: [] });

		expect(await setParkedLabel({ settings: queueSettingsFixture({ parkedLabel: 'queue-parked' }), ticketId: 'id-70', parked: true })).toStrictEqual({
			error: "there is no 'LO' team to create the 'queue-parked' label on",
		});
		expect(added).toStrictEqual([]);
	});

	test('says so when the tracker creates the label but names no id for it, rather than reporting a write that never happened', async () => {
		const { added } = setupClient({ labels: [], namesCreatedLabel: false });

		expect(await setParkedLabel({ settings: queueSettingsFixture({ parkedLabel: 'queue-parked' }), ticketId: 'id-70', parked: true })).toStrictEqual({
			error: "the tracker created the 'queue-parked' label but named no id for it",
		});
		expect(added).toStrictEqual([]);
	});

	test('hands a tracker failure back untouched', async () => {
		mockRunLinear.mockResolvedValue({ error: 'the tracker did not answer' });

		expect(await setParkedLabel({ settings: queueSettingsFixture({ parkedLabel: 'queue-parked' }), ticketId: 'id-70', parked: true })).toStrictEqual({
			error: 'the tracker did not answer',
		});
	});
});
