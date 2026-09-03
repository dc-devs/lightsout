import { describe, expect, jest, test } from '@jest/globals';
import { setExclusiveLabel } from '#src/ticketTracker/jira/setExclusiveLabel.ts';
import { jiraTrackerSettingsFixture } from '#tests/helpers/jiraQueueSettingsFixture.ts';

type JiraCallback = (client: { request: (params: unknown) => Promise<unknown> }) => Promise<unknown>;
const mockRunJira = jest.fn<(params: { settings: unknown; request: JiraCallback }) => Promise<unknown>>();

jest.mock('#src/ticketTracker/jira/runJira.ts', () => ({ runJira: (params: { settings: unknown; request: JiraCallback }) => mockRunJira(params) }));

const groupLabels = ['planning-complete', 'planning-needs-plan'];

/** A Jira holding these labels on the issue, recording every request it is asked for. */
const setupClient = ({ labels }: { labels: string[] | null }) => {
	const request = jest.fn<(params: unknown) => Promise<unknown>>().mockResolvedValueOnce({ fields: { labels } }).mockResolvedValueOnce(undefined);
	mockRunJira.mockImplementation(({ request: call }) => call({ request }));

	return { request };
};

const setExclusive = ({ label = 'planning-complete', group = groupLabels }: { label?: string; group?: string[] } = {}) =>
	setExclusiveLabel({ settings: jiraTrackerSettingsFixture(), ticketId: 'LO/1', label, groupLabels: group });

describe('Jira setExclusiveLabel', () => {
	test('reads the issue’s labels and writes the add and every remove in one update', async () => {
		const { request } = setupClient({ labels: ['planning-needs-plan'] });

		expect(await setExclusive()).toBeUndefined();

		expect(request).toHaveBeenNthCalledWith(1, { method: 'GET', path: '/rest/api/3/issue/LO%2F1?fields=labels', response: 'json' });
		expect(request).toHaveBeenNthCalledWith(2, {
			method: 'PUT',
			path: '/rest/api/3/issue/LO%2F1',
			body: { update: { labels: [{ add: 'planning-complete' }, { remove: 'planning-needs-plan' }] } },
			response: 'empty',
		});
	});

	test('writes nothing when the ticket already carries exactly the target', async () => {
		const { request } = setupClient({ labels: ['planning-complete'] });

		expect(await setExclusive()).toBeUndefined();
		expect(request).toHaveBeenCalledTimes(1);
	});

	test('leaves a label outside the group alone — the group is the only thing this write owns', async () => {
		const { request } = setupClient({ labels: ['bug', 'planning-needs-plan'] });

		await setExclusive();

		expect(request).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ body: { update: { labels: [{ add: 'planning-complete' }, { remove: 'planning-needs-plan' }] } } }),
		);
	});

	test('removes every group member the ticket carries, and no group member it does not', async () => {
		const { request } = setupClient({ labels: ['size-m', 'size-l'] });

		await setExclusive({ label: 'size-s', group: ['size-s', 'size-m', 'size-l', 'size-xl'] });

		expect(request).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ body: { update: { labels: [{ add: 'size-s' }, { remove: 'size-m' }, { remove: 'size-l' }] } } }),
		);
	});

	test('reads a ticket the tracker holds no labels for as carrying none, and adds the target to it', async () => {
		const { request } = setupClient({ labels: null });

		await setExclusive();

		expect(request).toHaveBeenNthCalledWith(2, expect.objectContaining({ body: { update: { labels: [{ add: 'planning-complete' }] } } }));
	});

	test('passes REST failures through unchanged', async () => {
		mockRunJira.mockResolvedValue({ error: 'denied' });

		expect(await setExclusive()).toStrictEqual({ error: 'denied' });
	});
});
