import { describe, expect, jest, test } from '@jest/globals';
import { getTicketsByIdentifiers } from '#src/queue/tracker/index.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';

// Mocked Imports
// -------------------------
// `runLinear` is the one place a call leaves the machine; stubbing it pins the
// filter this lookup asks for and the routes it derives, with no network.
type LinearCall = (client: unknown) => Promise<unknown>;

const mockRunLinear = jest.fn<(params: { apiKey: string; call: LinearCall }) => Promise<unknown>>();

jest.mock('#src/queue/tracker/runLinear.ts', () => ({ runLinear: (params: { apiKey: string; call: LinearCall }) => mockRunLinear(params) }));
// -------------------------

const settings = queueSettingsFixture();

const issueOf = ({ number, labels }: { number: number; labels: string[] }) => ({
	id: `id-${number}`,
	identifier: `LO-${number}`,
	title: `Ticket ${number}`,
	description: '',
	priority: 3,
	createdAt: new Date('2026-02-02T00:00:00.000Z'),
	labels: () => Promise.resolve({ nodes: labels.map((name) => ({ name })) }),
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

/** The shape the adapter walks: a real connection appends the next page onto itself and answers itself. */
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
			{ id: 'id-70', identifier: 'LO-70', title: 'Ticket 70', description: '', priority: 3, createdAt: '2026-02-02T00:00:00.000Z', route: 'direct' },
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

	test('omits a ticket whose route labels were all removed — that is the user withdrawing the automation', async () => {
		setupClient({ issues: [issueOf({ number: 70, labels: ['bug'] })] });

		expect(await getTicketsByIdentifiers({ settings, identifiers: ['LO-70'] })).toStrictEqual([]);
	});

	test('answers one summary per route label a ticket carries, so the drain’s double-label skip sees it the same way either route in', async () => {
		setupClient({ issues: [issueOf({ number: 70, labels: ['route-direct', 'route-auto-plan'] })] });

		const tickets = await getTicketsByIdentifiers({ settings, identifiers: ['LO-70'] });

		expect(tickets).toEqual([expect.objectContaining({ route: 'direct' }), expect.objectContaining({ route: 'auto-plan' })]);
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
