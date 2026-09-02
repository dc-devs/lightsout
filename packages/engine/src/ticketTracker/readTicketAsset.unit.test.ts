import { describe, expect, jest, test } from '@jest/globals';
import { readTicketAsset } from '#src/ticketTracker/index.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// The download is a plain authorised GET rather than a client call, so `fetch`
// is the whole seam — the shared Jest config's `restoreMocks` puts the real one
// back after each test.
// -------------------------

const settings = trackerSettingsFixture();
const assetUrl = 'https://assets.example/plan.md';

/** One request the read made, reduced to what the assertions care about. */
interface RecordedRequest {
	url: string;
	headers: Record<string, string>;
	/** Whether a deadline was attached — the contract `runLinear` keeps and this file keeps without it. */
	deadline: boolean;
}

interface FetchStub {
	ok?: boolean;
	status?: number;
	body?: string;
	/** What the request rejects with instead of answering, when the test is about a network that failed. */
	rejection?: unknown;
}

const stubFetch = ({ ok = true, status = 200, body = '# the plan\n', rejection }: FetchStub = {}) => {
	const requests: RecordedRequest[] = [];

	jest.spyOn(globalThis, 'fetch').mockImplementation((input: string | URL | Request, init?: RequestInit) => {
		// The cast reads the request back in the shape the subject sends — a plain
		// header record — which the wide `RequestInit` union cannot narrow to.
		requests.push({ url: String(input), headers: init?.headers as Record<string, string>, deadline: init?.signal !== undefined });

		// Only the three members the subject reads: a real Response cannot be
		// built from a plain object, and nothing here needs one.
		return rejection === undefined ? Promise.resolve({ ok, status, text: () => Promise.resolve(body) } as unknown as Response) : Promise.reject(rejection);
	});

	return requests;
};

describe('readTicketAsset', () => {
	test('sends the API key bare in an Authorization header, under a deadline, and answers the body text', async () => {
		const requests = stubFetch();

		expect(await readTicketAsset({ settings, url: assetUrl })).toBe('# the plan\n');
		// bare, with no `Bearer` prefix — the form a Linear personal key takes
		expect(requests).toStrictEqual([{ url: assetUrl, headers: { Authorization: 'lin_key' }, deadline: true }]);
	});

	test('names the URL and the status when the tracker refused the asset', async () => {
		stubFetch({ ok: false, status: 403 });

		expect(await readTicketAsset({ settings, url: assetUrl })).toStrictEqual({ error: `the tracker refused ${assetUrl}: HTTP 403` });
	});

	test('answers a failure rather than throwing when the request rejects', async () => {
		stubFetch({ rejection: new Error('the network is unreachable') });

		expect(await readTicketAsset({ settings, url: assetUrl })).toStrictEqual({ error: 'the network is unreachable' });
	});

	test('answers a failure when the rejection was not an Error at all', async () => {
		stubFetch({ rejection: 'aborted' });

		expect(await readTicketAsset({ settings, url: assetUrl })).toStrictEqual({ error: 'aborted' });
	});
});
