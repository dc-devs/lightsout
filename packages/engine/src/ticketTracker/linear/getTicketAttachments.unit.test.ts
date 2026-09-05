import { describe, expect, jest, test } from '@jest/globals';
import { getTicketAttachments } from '#src/ticketTracker/linear/getTicketAttachments.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// `runLinear` is the one place a call leaves the machine; stubbing it pins the
// filter this read asks for and the shape it hands back, with no network.
type LinearCall = (client: unknown) => Promise<unknown>;

const mockRunLinear = jest.fn<(params: { apiKey: string; call: LinearCall }) => Promise<unknown>>();

jest.mock('#src/ticketTracker/linear/runLinear.ts', () => ({ runLinear: (params: { apiKey: string; call: LinearCall }) => mockRunLinear(params) }));
// -------------------------

const settings = trackerSettingsFixture();

type Attachment = { id: string; title: string; url: string; subtitle?: string; source?: Record<string, unknown> };

/** The shape the seam walks: a real connection appends the next page onto itself and answers itself. */
interface FakeConnection {
	nodes: Attachment[];
	pageInfo: { hasNextPage: boolean };
	fetchNext: () => Promise<FakeConnection>;
}

const singlePage = ({ nodes }: { nodes: Attachment[] }): FakeConnection => {
	const page: FakeConnection = { nodes, pageInfo: { hasNextPage: false }, fetchNext: () => Promise.resolve(page) };

	return page;
};

const twoPages = ({ first, second }: { first: Attachment[]; second: Attachment[] }): FakeConnection => {
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

/** The issue page the lookup walks before it ever reaches an attachment. */
interface FakeIssuePage {
	nodes: { attachments: () => Promise<FakeConnection> }[];
	pageInfo: { hasNextPage: boolean };
	fetchNext: () => Promise<FakeIssuePage>;
}

const setupClient = ({ found, attachments }: { found: boolean; attachments?: FakeConnection }) => {
	const filters: unknown[] = [];

	mockRunLinear.mockImplementation(({ call }) =>
		call({
			issues: (variables: { filter: unknown }) => {
				filters.push(variables.filter);

				const nodes = found ? [{ attachments: () => Promise.resolve(attachments ?? singlePage({ nodes: [] })) }] : [];
				const page: FakeIssuePage = { nodes, pageInfo: { hasNextPage: false }, fetchNext: () => Promise.resolve(page) };

				return Promise.resolve(page);
			},
		}),
	);

	return { filters };
};

describe('getTicketAttachments', () => {
	test('asks for the one issue the identifier names and maps its attachments to id, title and url', async () => {
		const { filters } = setupClient({
			found: true,
			attachments: singlePage({ nodes: [{ id: 'att-1', title: 'plan.md', url: 'https://assets.example/plan.md' }] }),
		});

		expect(await getTicketAttachments({ settings, identifier: 'lo-54' })).toStrictEqual([
			{ id: 'att-1', title: 'plan.md', url: 'https://assets.example/plan.md' },
		]);
		expect(filters).toStrictEqual([{ team: { key: { eq: 'LO' } }, number: { eq: 54 } }]);
	});

	test('never calls the tracker for an identifier carrying no ticket number, because there is nothing a filter could ask for', async () => {
		expect(await getTicketAttachments({ settings, identifier: 'scratch' })).toStrictEqual({ error: "'scratch' names no ticket number" });
		expect(mockRunLinear).not.toHaveBeenCalled();
	});

	test('names the identifier and the team when the team has no such ticket, rather than answering an empty list', async () => {
		setupClient({ found: false });

		expect(await getTicketAttachments({ settings, identifier: 'lo-54' })).toStrictEqual({ error: "no ticket 'lo-54' in team LO" });
	});

	test('answers an empty list for a ticket that carries no attachment yet', async () => {
		setupClient({ found: true, attachments: singlePage({ nodes: [] }) });

		expect(await getTicketAttachments({ settings, identifier: 'lo-54' })).toStrictEqual([]);
	});

	test('pages the connection to exhaustion, so a phased plan’s later phases are never left off the list', async () => {
		setupClient({
			found: true,
			attachments: twoPages({
				first: [{ id: 'att-1', title: 'overview.md', url: 'https://assets.example/overview.md' }],
				second: [{ id: 'att-2', title: 'phase4-fetch.md', url: 'https://assets.example/phase4-fetch.md' }],
			}),
		});

		expect(await getTicketAttachments({ settings, identifier: 'lo-54' })).toStrictEqual([
			{ id: 'att-1', title: 'overview.md', url: 'https://assets.example/overview.md' },
			{ id: 'att-2', title: 'phase4-fetch.md', url: 'https://assets.example/phase4-fetch.md' },
		]);
	});

	test('hands runLinear the api key the settings carry, so the call authenticates as the configured tracker identity', async () => {
		setupClient({ found: true });

		await getTicketAttachments({ settings, identifier: 'lo-54' });

		expect(mockRunLinear).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'lin_key' }));
	});

	test('reads the number out of an upper-case reference too, so a plan folder’s lower-case name asks for the same ticket the tracker spells in capitals', async () => {
		const { filters } = setupClient({ found: true });

		await getTicketAttachments({ settings, identifier: 'LO-54' });

		expect(filters).toStrictEqual([{ team: { key: { eq: 'LO' } }, number: { eq: 54 } }]);
	});

	test('maps each attachment down to id, title and url, so nothing else the tracker hangs off a node leaks above the seam', async () => {
		setupClient({
			found: true,
			attachments: singlePage({
				nodes: [
					{
						id: 'att-1',
						title: 'brainstorm-notes.md',
						url: 'https://assets.example/brainstorm-notes.md',
						subtitle: 'attached by publish',
						source: { type: 'linear' },
					},
				],
			}),
		});

		const attachments = await getTicketAttachments({ settings, identifier: 'lo-54' });

		expect(attachments).toStrictEqual([{ id: 'att-1', title: 'brainstorm-notes.md', url: 'https://assets.example/brainstorm-notes.md' }]);
	});

	test('never calls the tracker for a reference whose number segment is empty, which is a mis-typed reference rather than a ticket', async () => {
		expect(await getTicketAttachments({ settings, identifier: 'lo-' })).toStrictEqual({ error: "'lo-' names no ticket number" });
		expect(mockRunLinear).not.toHaveBeenCalled();
	});

	test('hands a tracker failure back untouched', async () => {
		mockRunLinear.mockResolvedValue({ error: 'the tracker did not answer' });

		expect(await getTicketAttachments({ settings, identifier: 'lo-54' })).toStrictEqual({ error: 'the tracker did not answer' });
	});
});
