import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { getTicketAttachments } from '#src/ticketTracker/jira/getTicketAttachments.ts';
import { readTicketAsset } from '#src/ticketTracker/jira/readTicketAsset.ts';
import { setTicketAttachment } from '#src/ticketTracker/jira/setTicketAttachment.ts';
import { jiraTrackerSettingsFixture } from '#tests/helpers/jiraQueueSettingsFixture.ts';

type JiraCallback = (client: { request: (params: unknown) => Promise<unknown> }) => Promise<unknown>;
const mockRunJira = jest.fn<(params: { settings: unknown; request: JiraCallback }) => Promise<unknown>>();

jest.mock('#src/ticketTracker/jira/runJira.ts', () => ({ runJira: (params: { settings: unknown; request: JiraCallback }) => mockRunJira(params) }));

const settings = jiraTrackerSettingsFixture();

beforeEach(() => {
	mockRunJira.mockClear();
});

describe('Jira durable attachments', () => {
	test('lists issue attachments with content URLs constructed on the configured Jira origin', async () => {
		const request = jest.fn<(params: unknown) => Promise<unknown>>().mockResolvedValue({
			fields: { attachment: [{ id: '17', filename: 'plan.md', content: 'https://attacker.example/steal' }] },
		});
		mockRunJira.mockImplementation(({ request: call }) => call({ request }));

		expect(await getTicketAttachments({ settings, identifier: 'lo-54' })).toStrictEqual([
			{ id: '17', title: 'plan.md', url: 'https://example.atlassian.net/rest/api/3/attachment/content/17' },
		]);
		expect(request).toHaveBeenCalledWith({ method: 'GET', path: '/rest/api/3/issue/LO-54?fields=attachment', response: 'json' });
	});

	test('uploads and links the replacement before deleting captured same-title attachments', async () => {
		const request = jest
			.fn<(params: unknown) => Promise<unknown>>()
			.mockResolvedValueOnce({
				fields: {
					attachment: [
						{ id: 'old-1', filename: 'plan.md' },
						{ id: 'other', filename: 'notes.md' },
					],
				},
			})
			.mockResolvedValueOnce([{ id: 'new-1', filename: 'plan.md' }])
			.mockResolvedValueOnce(undefined);
		mockRunJira.mockImplementation(({ request: call }) => call({ request }));

		expect(
			await setTicketAttachment({ settings, ticketId: '10054', title: 'plan.md', content: Buffer.from('# plan'), contentType: 'text/markdown' }),
		).toBeUndefined();
		expect(request.mock.calls.map(([params]) => (params as { method: string }).method)).toStrictEqual(['GET', 'POST', 'DELETE']);
		expect(request).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				method: 'POST',
				path: '/rest/api/3/issue/10054/attachments',
				headers: { 'X-Atlassian-Token': 'no-check' },
				body: expect.any(FormData),
				response: 'json',
			}),
		);
		expect(request).toHaveBeenNthCalledWith(3, { method: 'DELETE', path: '/rest/api/3/attachment/old-1', response: 'empty' });
	});

	test('keeps the old copy when upload/link does not report the new attachment', async () => {
		const request = jest
			.fn<(params: unknown) => Promise<unknown>>()
			.mockResolvedValueOnce({ fields: { attachment: [{ id: 'old-1', filename: 'plan.md' }] } })
			.mockResolvedValueOnce([]);
		mockRunJira.mockImplementation(({ request: call }) => call({ request }));

		expect(
			await setTicketAttachment({ settings, ticketId: '10054', title: 'plan.md', content: Buffer.from('# plan'), contentType: 'text/markdown' }),
		).toStrictEqual({ error: "Jira accepted the upload for 'plan.md' but did not report a linked attachment" });
		expect(request.mock.calls.map(([params]) => (params as { method: string }).method)).toStrictEqual(['GET', 'POST']);
	});

	test('returns a duplicate-safe cleanup failure after a new copy exists', async () => {
		const request = jest
			.fn<(params: unknown) => Promise<unknown>>()
			.mockResolvedValueOnce({ fields: { attachment: [{ id: 'old-1', filename: 'plan.md' }] } })
			.mockResolvedValueOnce([{ id: 'new-1', filename: 'plan.md' }])
			.mockRejectedValueOnce(new Error('delete denied'));
		mockRunJira.mockImplementation(({ request: call }) => call({ request }));

		expect(
			await setTicketAttachment({ settings, ticketId: '10054', title: 'plan.md', content: Buffer.from('# plan'), contentType: 'text/markdown' }),
		).toStrictEqual({
			error: "Jira linked the new 'plan.md' but could not delete old attachment 'old-1': delete denied; duplicate copies remain",
		});
	});

	test.each([
		'https://evil.example/rest/api/3/attachment/content/17',
		'https://example.atlassian.net.evil.example/rest/api/3/attachment/content/17',
		'https://example.atlassian.net/rest/api/3/issue/LO-54',
	])('refuses to send Jira credentials to an untrusted asset URL: %s', async (url) => {
		expect(await readTicketAsset({ settings, url })).toStrictEqual({
			error: `refusing to send tracker credentials to untrusted attachment URL '${url}'`,
		});
		expect(mockRunJira).not.toHaveBeenCalled();
	});

	test('downloads a trusted attachment through the authenticated Jira client', async () => {
		const request = jest.fn<(params: unknown) => Promise<unknown>>().mockResolvedValue('# plan');
		mockRunJira.mockImplementation(({ request: call }) => call({ request }));

		expect(await readTicketAsset({ settings, url: 'https://example.atlassian.net/rest/api/3/attachment/content/17' })).toBe('# plan');
		expect(request).toHaveBeenCalledWith({ method: 'GET', path: '/rest/api/3/attachment/content/17', response: 'text' });
	});
});
