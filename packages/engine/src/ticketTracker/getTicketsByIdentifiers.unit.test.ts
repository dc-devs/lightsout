import { describe, expect, jest, test } from '@jest/globals';
import { getTicketsByIdentifiers } from '#src/ticketTracker/index.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// `runLinear` is the one place a call leaves the machine; stubbing it pins the
// filter this lookup asks for and the shape it hands back, with no network.
type LinearCall = (client: unknown) => Promise<unknown>;

const mockRunLinear = jest.fn<(params: { apiKey: string; call: LinearCall }) => Promise<unknown>>();

jest.mock('#src/ticketTracker/runLinear.ts', () => ({ runLinear: (params: { apiKey: string; call: LinearCall }) => mockRunLinear(params) }));
// -------------------------

const settings = trackerSettingsFixture();

/** How many times each issue's relations were read, so a second label can be shown to cost no extra round trip. */
const relationReads = new Map<string, number>();

const issueOf = ({ number, labels, blockedBy = [] }: { number: number; labels: string[]; blockedBy?: string[] }) => ({
	id: `id-${number}`,
	identifier: `LO-${number}`,
	title: `Ticket ${number}`,
	description: '',
	priority: 3,
	createdAt: new Date('2026-02-02T00:00:00.000Z'),
	labels: () => {
		const page = { nodes: labels.map((name) => ({ name })), pageInfo: { hasNextPage: false }, fetchNext: () => Promise.resolve(page) };

		return Promise.resolve(page);
	},
	inverseRelations: () => {
		relationReads.set(`LO-${number}`, (relationReads.get(`LO-${number}`) ?? 0) + 1);

		const page = {
			nodes: blockedBy.map((identifier) => ({ type: 'blocks', issue: Promise.resolve({ identifier, state: Promise.resolve({ type: 'started' }) }) })),
			pageInfo: { hasNextPage: false },
			fetchNext: () => Promise.resolve(page),
		};

		return Promise.resolve(page);
	},
});

const setupClient = ({ issues }: { issues: ReturnType<typeof issueOf>[] }) => {
	const filters: unknown[] = [];

	mockRunLinear.mockImplementation(({ call }) =>
		call({
			issues: (variables: { filter: unknown }) => {
				filters.push(variables.filter);

				return Promise.resolve({ nodes: issues, pageInfo: { hasNextPage: false } });
			},
		}),
	);

	return { filters };
};

/** The shape the seam walks: a real connection appends the next page onto itself and answers itself. */
interface FakeConnection {
	nodes: unknown[];
	pageInfo: { hasNextPage: boolean };
	fetchNext: () => Promise<FakeConnection>;
}

/** A client whose first page names a second one, the way a connection larger than a page answers. */
const setupPagedClient = ({ first, second }: { first: ReturnType<typeof issueOf>[]; second: ReturnType<typeof issueOf>[] }) => {
	const page: FakeConnection = {
		nodes: first,
		pageInfo: { hasNextPage: true },
		fetchNext: () => {
			page.nodes = [...first, ...second];
			page.pageInfo.hasNextPage = false;

			return Promise.resolve(page);
		},
	};

	mockRunLinear.mockImplementation(({ call }) => call({ issues: () => Promise.resolve(page) }));
};

describe('getTicketsByIdentifiers', () => {
	test('asks for these exact issue numbers with NO status filter — a parked ticket sits at the in-progress status the eligible query hides', async () => {
		const { filters } = setupClient({ issues: [issueOf({ number: 70, labels: ['route-direct'] })] });

		const tickets = await getTicketsByIdentifiers({ settings, identifiers: ['LO-70', 'lo-71'] });

		expect(filters).toStrictEqual([{ team: { key: { eq: 'LO' } }, number: { in: [70, 71] } }]);
		expect(tickets).toStrictEqual([
			{
				id: 'id-70',
				identifier: 'LO-70',
				title: 'Ticket 70',
				description: '',
				priority: 3,
				createdAt: '2026-02-02T00:00:00.000Z',
				labels: ['route-direct'],
				unfinishedBlockers: [],
			},
		]);
	});

	test('never makes a call for an empty list, because there is nothing to look up', async () => {
		expect(await getTicketsByIdentifiers({ settings, identifiers: [] })).toStrictEqual([]);
		expect(mockRunLinear).not.toHaveBeenCalled();
	});

	test('never makes a call when no identifier carries an issue number, because there is nothing a filter could ask for', async () => {
		expect(await getTicketsByIdentifiers({ settings, identifiers: ['scratch', 'lo-'] })).toStrictEqual([]);
		expect(mockRunLinear).not.toHaveBeenCalled();
	});

	test('drops the identifiers it cannot read and asks for the rest, so one odd branch name never hides the parked tickets beside it', async () => {
		const { filters } = setupClient({ issues: [issueOf({ number: 70, labels: ['route-direct'] })] });

		const tickets = await getTicketsByIdentifiers({ settings, identifiers: ['scratch', 'LO-70'] });

		expect(filters).toStrictEqual([{ team: { key: { eq: 'LO' } }, number: { in: [70] } }]);
		expect(tickets).toEqual([expect.objectContaining({ identifier: 'LO-70' })]);
	});

	test('reports every label an issue carries, because what a label means is the caller’s to decide', async () => {
		setupClient({ issues: [issueOf({ number: 70, labels: ['route-direct', 'route-auto-plan'] })] });

		expect(await getTicketsByIdentifiers({ settings, identifiers: ['LO-70'] })).toEqual([
			expect.objectContaining({ labels: ['route-direct', 'route-auto-plan'] }),
		]);
	});

	test('answers a ticket carrying no label at all, rather than dropping it — the seam reports what it saw', async () => {
		setupClient({ issues: [issueOf({ number: 70, labels: [] })] });

		expect(await getTicketsByIdentifiers({ settings, identifiers: ['LO-70'] })).toEqual([expect.objectContaining({ identifier: 'LO-70', labels: [] })]);
	});

	test('carries a resumed ticket’s unfinished blockers, so one uniform filter covers resumed and fresh pickups alike', async () => {
		setupClient({ issues: [issueOf({ number: 70, labels: ['route-direct'], blockedBy: ['LO-69'] })] });

		expect(await getTicketsByIdentifiers({ settings, identifiers: ['LO-70'] })).toEqual([expect.objectContaining({ unfinishedBlockers: ['LO-69'] })]);
	});

	test('reads a double-labelled ticket’s relations once, so a second route label costs no second round trip', async () => {
		relationReads.clear();
		setupClient({ issues: [issueOf({ number: 70, labels: ['route-direct', 'route-auto-plan'], blockedBy: ['LO-69'] })] });

		const tickets = await getTicketsByIdentifiers({ settings, identifiers: ['LO-70'] });

		expect(relationReads.get('LO-70')).toBe(1);
		expect(tickets).toEqual([expect.objectContaining({ labels: ['route-direct', 'route-auto-plan'], unfinishedBlockers: ['LO-69'] })]);
	});

	test('pages the connection to exhaustion, so a restart holding more parked worktrees than one page reads them all', async () => {
		setupPagedClient({ first: [issueOf({ number: 70, labels: ['route-direct'] })], second: [issueOf({ number: 71, labels: ['route-direct'] })] });

		const tickets = await getTicketsByIdentifiers({ settings, identifiers: ['LO-70', 'LO-71'] });

		expect(tickets).toEqual([expect.objectContaining({ identifier: 'LO-70' }), expect.objectContaining({ identifier: 'LO-71' })]);
	});

	test('hands a tracker failure back untouched', async () => {
		mockRunLinear.mockResolvedValue({ error: 'the tracker did not answer' });

		expect(await getTicketsByIdentifiers({ settings, identifiers: ['LO-70'] })).toStrictEqual({ error: 'the tracker did not answer' });
	});
});
