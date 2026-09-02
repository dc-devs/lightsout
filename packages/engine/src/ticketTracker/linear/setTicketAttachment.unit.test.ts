import { describe, expect, jest, test } from '@jest/globals';
import { setTicketAttachment } from '#src/ticketTracker/linear/setTicketAttachment.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// `runLinear` is the one place a call leaves the machine; stubbing it pins the
// order of the four steps this write makes with no network. The upload's PUT is
// the one call the write makes outside the client, so `fetch` is spied on too —
// the shared Jest config's `restoreMocks` puts the real one back after each
// test.
type LinearCall = (client: unknown) => Promise<unknown>;

const mockRunLinear = jest.fn<(params: { apiKey: string; call: LinearCall }) => Promise<unknown>>();

jest.mock('#src/ticketTracker/linear/runLinear.ts', () => ({ runLinear: (params: { apiKey: string; call: LinearCall }) => mockRunLinear(params) }));
// -------------------------

const settings = trackerSettingsFixture();

/** One PUT the upload made, reduced to what the assertions care about. */
interface RecordedUpload {
	url: string;
	method: string | undefined;
	headers: Record<string, string>;
	byteLength: number;
}

/** The shape the seam walks: a real connection appends the next page onto itself and answers itself. */
interface FakeConnection {
	nodes: { id: string; title: string }[];
	pageInfo: { hasNextPage: boolean };
	fetchNext: () => Promise<FakeConnection>;
}

/** A one-page attachment connection, the way an issue with few attachments answers. */
const singlePage = ({ nodes }: { nodes: { id: string; title: string }[] }): FakeConnection => {
	const page: FakeConnection = { nodes, pageInfo: { hasNextPage: false }, fetchNext: () => Promise.resolve(page) };

	return page;
};

/** A connection whose first page names a second one, the way a list larger than a page answers. */
const twoPages = ({ first, second }: { first: { id: string; title: string }[]; second: { id: string; title: string }[] }): FakeConnection => {
	const page: FakeConnection = {
		nodes: first,
		pageInfo: { hasNextPage: true },
		fetchNext: () => {
			page.nodes = [...first, ...second];
			page.pageInfo.hasNextPage = false;

			return Promise.resolve(page);
		},
	};

	return page;
};

/** The prepared upload a tracker that is working answers with. */
const preparedUpload = {
	uploadUrl: 'https://uploads.example/put',
	assetUrl: 'https://assets.example/plan.md',
	headers: [{ key: 'x-amz-acl', value: 'private' }],
};

const setupClient = (params: {
	attachments: FakeConnection;
	uploadFile?: { uploadUrl: string; assetUrl: string; headers: { key: string; value: string }[] } | null;
	uploadOk?: boolean;
	deleteFailure?: Error;
}) => {
	const { attachments, uploadOk = true, deleteFailure } = params;
	// Read by key rather than by a destructuring default, so a test can hand the
	// payload an `uploadFile` that is present and undefined — the shape the SDK's
	// own optional field takes — and still get it, instead of the default.
	const uploadFile = 'uploadFile' in params ? params.uploadFile : preparedUpload;
	const calls: string[] = [];
	const deleted: string[] = [];
	const uploads: RecordedUpload[] = [];
	const created: unknown[] = [];
	const prepared: { contentType: string; filename: string; size: number }[] = [];

	jest.spyOn(globalThis, 'fetch').mockImplementation((url: string | URL | Request, init?: RequestInit) => {
		calls.push('put');
		// The two casts read the request back in the shapes the subject sends —
		// a header record and a byte view — which the wide `RequestInit` unions
		// cannot narrow to on their own.
		const body = init?.body as Uint8Array;

		uploads.push({
			url: String(url),
			method: init?.method,
			headers: init?.headers as Record<string, string>,
			byteLength: body.byteLength,
		});

		// Only the three fields the subject reads: a real Response cannot be built
		// from a plain object, and nothing here needs one.
		return Promise.resolve({ ok: uploadOk, status: uploadOk ? 200 : 403, statusText: uploadOk ? 'OK' : 'Forbidden' } as unknown as Response);
	});

	mockRunLinear.mockImplementation(({ call }) =>
		call({
			issue: (id: string) => {
				calls.push(`issue:${id}`);

				return Promise.resolve({ attachments: () => Promise.resolve(attachments) });
			},
			deleteAttachment: (id: string) => {
				calls.push('deleteAttachment');
				deleted.push(id);

				return deleteFailure === undefined ? Promise.resolve({ success: true }) : Promise.reject(deleteFailure);
			},
			fileUpload: (contentType: string, filename: string, size: number) => {
				calls.push('fileUpload');
				prepared.push({ contentType, filename, size });

				return Promise.resolve({ uploadFile });
			},
			createAttachment: (input: unknown) => {
				calls.push('createAttachment');
				created.push(input);

				return Promise.resolve({ success: true });
			},
		}),
	);

	return { calls, deleted, uploads, created, prepared };
};

const publishOne = ({ title = 'plan.md', contentType = 'text/markdown' }: { title?: string; contentType?: string } = {}) =>
	setTicketAttachment({ settings, ticketId: 'id-54', title, content: Buffer.from('# the plan\n'), contentType });

describe('setTicketAttachment', () => {
	test('uploads and links the replacement before deleting the same-titled old attachment', async () => {
		const { calls, deleted, created } = setupClient({ attachments: singlePage({ nodes: [{ id: 'att-1', title: 'plan.md' }] }) });

		expect(await publishOne()).toBeUndefined();
		expect(calls).toStrictEqual(['issue:id-54', 'fileUpload', 'put', 'createAttachment', 'deleteAttachment']);
		expect(deleted).toStrictEqual(['att-1']);
		// the asset URL the tracker answered, under the file's own name
		expect(created).toStrictEqual([{ issueId: 'id-54', title: 'plan.md', url: 'https://assets.example/plan.md' }]);
	});

	test('leaves an attachment with a different title alone — only a replacement is a delete', async () => {
		const { calls, deleted } = setupClient({ attachments: singlePage({ nodes: [{ id: 'att-9', title: 'screenshot.png' }] }) });

		expect(await publishOne()).toBeUndefined();
		expect(deleted).toStrictEqual([]);
		expect(calls).toStrictEqual(['issue:id-54', 'fileUpload', 'put', 'createAttachment']);
	});

	test('pages the attachment list, so a same-titled attachment on the second page is still replaced', async () => {
		const { deleted } = setupClient({
			attachments: twoPages({ first: [{ id: 'att-1', title: 'notes.md' }], second: [{ id: 'att-2', title: 'plan.md' }] }),
		});

		expect(await publishOne()).toBeUndefined();
		expect(deleted).toStrictEqual(['att-2']);
	});

	test('deletes every same-titled attachment, so a pair doubled before the replace existed cannot survive it', async () => {
		const { calls, deleted } = setupClient({
			attachments: singlePage({
				nodes: [
					{ id: 'att-1', title: 'plan.md' },
					{ id: 'att-2', title: 'notes.md' },
					{ id: 'att-3', title: 'plan.md' },
				],
			}),
		});

		expect(await publishOne()).toBeUndefined();
		expect(deleted).toStrictEqual(['att-1', 'att-3']);
		expect(calls).toStrictEqual(['issue:id-54', 'fileUpload', 'put', 'createAttachment', 'deleteAttachment', 'deleteAttachment']);
	});

	test('sends every header the upload payload named, plus the content type, and the file’s own size', async () => {
		const { uploads, prepared } = setupClient({ attachments: singlePage({ nodes: [] }) });

		await publishOne({ title: 'decisions.json', contentType: 'application/json' });

		expect(prepared).toStrictEqual([{ contentType: 'application/json', filename: 'decisions.json', size: Buffer.from('# the plan\n').byteLength }]);
		expect(uploads).toStrictEqual([
			{
				url: 'https://uploads.example/put',
				method: 'PUT',
				headers: {
					'x-amz-acl': 'private',
					'Cache-Control': 'public, max-age=31536000',
					'Content-Type': 'application/json',
				},
				byteLength: Buffer.from('# the plan\n').byteLength,
			},
		]);
	});

	test('names the file when the tracker prepared no upload, and links nothing', async () => {
		const { calls, created } = setupClient({ attachments: singlePage({ nodes: [] }), uploadFile: null });

		expect(await publishOne()).toStrictEqual({ error: "the tracker did not prepare an upload for 'plan.md'" });
		expect(created).toStrictEqual([]);
		expect(calls).toStrictEqual(['issue:id-54', 'fileUpload']);
	});

	test('names the file when the payload carried no upload field at all, and links nothing', async () => {
		const { calls, created } = setupClient({ attachments: singlePage({ nodes: [] }), uploadFile: undefined });

		expect(await publishOne()).toStrictEqual({ error: "the tracker did not prepare an upload for 'plan.md'" });
		expect(created).toStrictEqual([]);
		expect(calls).toStrictEqual(['issue:id-54', 'fileUpload']);
	});

	test('names the file and the status when the PUT came back not-ok, and links nothing', async () => {
		const { calls, created, deleted } = setupClient({ attachments: singlePage({ nodes: [{ id: 'att-old', title: 'plan.md' }] }), uploadOk: false });

		expect(await publishOne()).toStrictEqual({ error: "uploading 'plan.md' failed: 403 Forbidden" });
		expect(created).toStrictEqual([]);
		expect(deleted).toStrictEqual([]);
		expect(calls).toStrictEqual(['issue:id-54', 'fileUpload', 'put']);
	});

	test('reports cleanup failure after the new copy is linked, leaving a duplicate instead of deleting first', async () => {
		const { calls } = setupClient({
			attachments: singlePage({ nodes: [{ id: 'att-old', title: 'plan.md' }] }),
			deleteFailure: new Error('cleanup denied'),
		});

		expect(await publishOne()).toStrictEqual({
			error: "the tracker linked the new 'plan.md' but could not delete old attachment 'att-old': cleanup denied; duplicate copies remain",
		});
		expect(calls).toStrictEqual(['issue:id-54', 'fileUpload', 'put', 'createAttachment', 'deleteAttachment']);
	});

	test('hands a tracker failure back untouched', async () => {
		mockRunLinear.mockResolvedValue({ error: 'the tracker did not answer' });

		expect(await publishOne()).toStrictEqual({ error: 'the tracker did not answer' });
	});
});
