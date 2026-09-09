import { describe, expect, jest, test } from '@jest/globals';
import { setTicketLabel } from '#src/ticketTracker/jira/setTicketLabel.ts';
import { jiraTrackerSettingsFixture } from '#tests/helpers/jiraQueueSettingsFixture.ts';

type JiraCallback = (client: { request: (params: unknown) => Promise<unknown> }) => Promise<unknown>;
const mockRunJira = jest.fn<(params: { settings: unknown; request: JiraCallback }) => Promise<unknown>>();

jest.mock('#src/ticketTracker/jira/runJira.ts', () => ({ runJira: (params: { settings: unknown; request: JiraCallback }) => mockRunJira(params) }));

describe('Jira setTicketLabel', () => {
	test('does nothing when no parked label is configured', async () => {
		mockRunJira.mockClear();

		expect(await setTicketLabel({ settings: jiraTrackerSettingsFixture(), ticketId: 'LO-1', label: undefined, present: true })).toBeUndefined();
		expect(mockRunJira).not.toHaveBeenCalled();
	});

	test.each([
		{ present: true, labels: null, operation: { add: 'queue-parked' } },
		{ present: false, labels: ['queue-parked'], operation: { remove: 'queue-parked' } },
	])('reads labels and writes the requested add or remove update', async ({ present, labels, operation }) => {
		const request = jest.fn<(params: unknown) => Promise<unknown>>().mockResolvedValueOnce({ fields: { labels } }).mockResolvedValueOnce(undefined);
		mockRunJira.mockImplementation(({ request: call }) => call({ request }));

		expect(await setTicketLabel({ settings: jiraTrackerSettingsFixture(), ticketId: 'LO/1', label: 'queue-parked', present })).toBeUndefined();
		expect(request).toHaveBeenNthCalledWith(1, { method: 'GET', path: '/rest/api/3/issue/LO%2F1?fields=labels', response: 'json' });
		expect(request).toHaveBeenNthCalledWith(2, {
			method: 'PUT',
			path: '/rest/api/3/issue/LO%2F1',
			body: { update: { labels: [operation] } },
			response: 'empty',
		});
	});

	test.each([
		{ present: true, labels: ['queue-parked'] },
		{ present: false, labels: [] },
	])('avoids a duplicate or ineffective update', async ({ present, labels }) => {
		const request = jest.fn<(params: unknown) => Promise<unknown>>().mockResolvedValue({ fields: { labels } });
		mockRunJira.mockImplementation(({ request: call }) => call({ request }));

		expect(await setTicketLabel({ settings: jiraTrackerSettingsFixture(), ticketId: 'LO-1', label: 'queue-parked', present })).toBeUndefined();
		expect(request).toHaveBeenCalledTimes(1);
	});

	test.each([
		{ present: true, labels: null, writes: [{ add: 'queue-blocked-gate-timed-out' }] },
		{ present: false, labels: ['queue-blocked-gate-timed-out'], writes: [{ remove: 'queue-blocked-gate-timed-out' }] },
		{ present: true, labels: ['queue-blocked-gate-timed-out'], writes: undefined },
		{ present: false, labels: [], writes: undefined },
	])('writes add or remove by the present flag, and nothing when already settled', async ({ present, labels, writes }) => {
		const request = jest.fn<(params: unknown) => Promise<unknown>>().mockResolvedValueOnce({ fields: { labels } }).mockResolvedValueOnce(undefined);
		mockRunJira.mockImplementation(({ request: call }) => call({ request }));

		const failure = await setTicketLabel({
			settings: jiraTrackerSettingsFixture(),
			ticketId: 'LO-9',
			label: 'queue-blocked-gate-timed-out',
			present,
		});

		expect(failure).toBeUndefined();
		expect(request.mock.calls.slice(1)).toStrictEqual(
			writes === undefined
				? []
				: [
						[
							{
								method: 'PUT',
								path: '/rest/api/3/issue/LO-9',
								body: { update: { labels: writes } },
								response: 'empty',
							},
						],
					],
		);
	});

	test('passes REST failures through unchanged', async () => {
		mockRunJira.mockResolvedValue({ error: 'denied' });

		expect(await setTicketLabel({ settings: jiraTrackerSettingsFixture(), ticketId: 'LO-1', label: 'queue-parked', present: true })).toStrictEqual({
			error: 'denied',
		});
	});
});
