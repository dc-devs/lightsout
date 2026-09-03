import { describe, expect, jest, test } from '@jest/globals';
import { listTickets } from '#src/ticketTracker/linear/listTickets.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// `runLinear` is the one place a client is built and a call leaves the machine.
// Stubbing it is what lets these tests pin the filter the seam asks for and the
// shapes it hands back, without a network or an API key.
type LinearCall = (client: unknown) => Promise<unknown>;

const mockRunLinear = jest.fn<(params: { apiKey: string; call: LinearCall }) => Promise<unknown>>();

jest.mock('#src/ticketTracker/linear/runLinear.ts', () => ({ runLinear: (params: { apiKey: string; call: LinearCall }) => mockRunLinear(params) }));
// -------------------------

const settings = trackerSettingsFixture();
const labelNames = ['route-direct', 'route-auto-plan'];
const statuses = ['Backlog', 'Ready to implement'];

const listConfigured = () => listTickets({ settings, labelNames, statuses });

/** The shape the seam walks: a real connection appends the next page onto itself and answers itself. */
interface FakeConnection {
	nodes: unknown[];
	pageInfo: { hasNextPage: boolean };
	fetchNext: () => Promise<FakeConnection>;
}

/** One inverse relation, as the seam reads it: a type, a source issue, and that source's workflow state. */
const relationOf = ({ type, blocker, stateType }: { type: string; blocker?: string; stateType?: string | null }) => ({
	type,
	issue:
		blocker === undefined
			? undefined
			: Promise.resolve({ identifier: blocker, state: stateType === null ? undefined : Promise.resolve({ type: stateType ?? 'started' }) }),
});

const issueOf = ({
	number,
	description,
	labels = ['route-direct'],
	labelPages = 1,
	relations = [],
	relationPages = 1,
	state = 'Backlog',
}: {
	number: number;
	description?: string | null;
	labels?: string[];
	labelPages?: number;
	relations?: ReturnType<typeof relationOf>[];
	relationPages?: number;
	/** The issue's workflow state name, or null for an issue whose state cannot be read at all. */
	state?: string | null;
}) => ({
	id: `id-${number}`,
	identifier: `LO-${number}`,
	title: `Ticket ${number}`,
	description,
	priority: 2,
	createdAt: new Date('2026-01-01T00:00:00.000Z'),
	state: state === null ? undefined : Promise.resolve({ name: state }),
	labels: () => {
		// A second page holds the tail of the label list, so a walker that stops
		// after the first one reports one route label where the issue carries two.
		const page: FakeConnection = {
			nodes: (labelPages > 1 ? labels.slice(0, 1) : labels).map((name) => ({ name })),
			pageInfo: { hasNextPage: labelPages > 1 },
			fetchNext: () => {
				page.nodes = labels.map((name) => ({ name }));
				page.pageInfo.hasNextPage = false;

				return Promise.resolve(page);
			},
		};

		return Promise.resolve(page);
	},
	inverseRelations: () => {
		// A second page holds the tail of the list, so a walker that stops after
		// the first one under-reports the blockers rather than obviously failing.
		const page: FakeConnection = {
			nodes: relationPages > 1 ? relations.slice(0, 1) : relations,
			pageInfo: { hasNextPage: relationPages > 1 },
			fetchNext: () => {
				page.nodes = relations;
				page.pageInfo.hasNextPage = false;

				return Promise.resolve(page);
			},
		};

		return Promise.resolve(page);
	},
});

/** A client whose one `issues` query answers these issues, optionally across two pages. */
const setupClient = ({ issues, pages }: { issues: ReturnType<typeof issueOf>[]; pages?: number }) => {
	const filters: unknown[] = [];
	let fetched = 0;

	const client = {
		issues: (variables: { filter: unknown }) => {
			filters.push(variables.filter);

			const pageInfo = { hasNextPage: issues.length > 0 && (pages ?? 1) > 1 };
			const page: FakeConnection = {
				nodes: issues,
				pageInfo,
				fetchNext: () => {
					fetched += 1;
					pageInfo.hasNextPage = false;

					return Promise.resolve(page);
				},
			};

			return Promise.resolve(page);
		},
	};

	mockRunLinear.mockImplementation(({ call }) => call(client));

	return { filters, fetchedPages: () => fetched };
};

describe('listTickets', () => {
	test('asks one query for the whole label set and the whole status set, and reports the labels each issue carries', async () => {
		const { filters } = setupClient({ issues: [issueOf({ number: 70 }), issueOf({ number: 71, labels: ['route-auto-plan'] })] });

		const tickets = await listConfigured();

		expect(filters).toStrictEqual([
			{
				team: { key: { eq: 'LO' } },
				labels: { name: { in: ['route-direct', 'route-auto-plan'] } },
				state: { name: { in: ['Backlog', 'Ready to implement'] } },
			},
		]);
		expect(tickets).toStrictEqual([
			{
				id: 'id-70',
				identifier: 'LO-70',
				title: 'Ticket 70',
				description: '',
				priority: 2,
				createdAt: '2026-01-01T00:00:00.000Z',
				labels: ['route-direct'],
				status: 'Backlog',
				unfinishedBlockers: [],
			},
			{
				id: 'id-71',
				identifier: 'LO-71',
				title: 'Ticket 71',
				description: '',
				priority: 2,
				createdAt: '2026-01-01T00:00:00.000Z',
				labels: ['route-auto-plan'],
				status: 'Backlog',
				unfinishedBlockers: [],
			},
		]);
	});

	test('returns a ticket carrying two of the named labels once, with both names — which is what lets the caller see the second one', async () => {
		setupClient({ issues: [issueOf({ number: 70, labels: ['route-direct', 'route-auto-plan'] })] });

		expect(await listConfigured()).toEqual([expect.objectContaining({ identifier: 'LO-70', labels: ['route-direct', 'route-auto-plan'] })]);
	});

	test('pages the label connection to exhaustion, so a ticket carrying two route labels never reads as carrying one', async () => {
		setupClient({ issues: [issueOf({ number: 70, labels: ['route-direct', 'route-auto-plan'], labelPages: 2 })] });

		expect(await listConfigured()).toEqual([expect.objectContaining({ labels: ['route-direct', 'route-auto-plan'] })]);
	});

	test('carries the ticket body through verbatim, because it is the whole brief a direct worker gets', async () => {
		setupClient({ issues: [issueOf({ number: 70, description: '# Do the thing' })] });

		expect(await listConfigured()).toEqual([expect.objectContaining({ description: '# Do the thing' })]);
	});

	test('reads a ticket the tracker holds no description for as an empty body rather than a missing one', async () => {
		setupClient({ issues: [issueOf({ number: 70, description: null })] });

		expect(await listConfigured()).toEqual([expect.objectContaining({ description: '' })]);
	});

	test('pages the connection to exhaustion — a silently truncated backlog reads as a smaller queue than exists', async () => {
		const { fetchedPages } = setupClient({ issues: [issueOf({ number: 70 })], pages: 2 });

		await listConfigured();

		expect(fetchedPages()).toBe(1);
	});

	test('reads a started blocking ticket as unfinished and carries its identifier, which is what holds the dependent back', async () => {
		setupClient({ issues: [issueOf({ number: 70, relations: [relationOf({ type: 'blocks', blocker: 'LO-69', stateType: 'started' })] })] });

		expect(await listConfigured()).toEqual([expect.objectContaining({ unfinishedBlockers: ['LO-69'] })]);
	});

	test('reads a completed blocker as finished, because the work the dependent waited on has shipped', async () => {
		setupClient({ issues: [issueOf({ number: 70, relations: [relationOf({ type: 'blocks', blocker: 'LO-69', stateType: 'completed' })] })] });

		expect(await listConfigured()).toEqual([expect.objectContaining({ unfinishedBlockers: [] })]);
	});

	test('reads a canceled blocker as finished too — a ticket someone gave up on must not block its dependent forever', async () => {
		setupClient({ issues: [issueOf({ number: 70, relations: [relationOf({ type: 'blocks', blocker: 'LO-69', stateType: 'canceled' })] })] });

		expect(await listConfigured()).toEqual([expect.objectContaining({ unfinishedBlockers: [] })]);
	});

	test('keeps only the blockers that are unfinished when a ticket waits on some that have shipped and some that have not', async () => {
		setupClient({
			issues: [
				issueOf({
					number: 70,
					relations: [
						relationOf({ type: 'blocks', blocker: 'LO-68', stateType: 'completed' }),
						relationOf({ type: 'blocks', blocker: 'LO-69', stateType: 'backlog' }),
					],
				}),
			],
		});

		expect(await listConfigured()).toEqual([expect.objectContaining({ unfinishedBlockers: ['LO-69'] })]);
	});

	test('keeps a blocker whose workflow state cannot be read — waiting one extra run beats shipping a dependent ahead of its blocker', async () => {
		setupClient({ issues: [issueOf({ number: 70, relations: [relationOf({ type: 'blocks', blocker: 'LO-69', stateType: null })] })] });

		expect(await listConfigured()).toEqual([expect.objectContaining({ unfinishedBlockers: ['LO-69'] })]);
	});

	test('ignores a relation whose source issue cannot be resolved at all, because a nameless block could never be satisfied', async () => {
		setupClient({ issues: [issueOf({ number: 70, relations: [relationOf({ type: 'blocks' })] })] });

		expect(await listConfigured()).toEqual([expect.objectContaining({ unfinishedBlockers: [] })]);
	});

	test('ignores relation types other than blocks, however unfinished their source is', async () => {
		setupClient({
			issues: [
				issueOf({
					number: 70,
					relations: [
						relationOf({ type: 'related', blocker: 'LO-68', stateType: 'started' }),
						relationOf({ type: 'duplicate', blocker: 'LO-67', stateType: 'started' }),
					],
				}),
			],
		});

		expect(await listConfigured()).toEqual([expect.objectContaining({ unfinishedBlockers: [] })]);
	});

	test('pages the relation connection to exhaustion — a truncated relation list ships a dependent ahead of its blocker', async () => {
		setupClient({
			issues: [
				issueOf({
					number: 70,
					relations: [relationOf({ type: 'blocks', blocker: 'LO-68' }), relationOf({ type: 'blocks', blocker: 'LO-69' })],
					relationPages: 2,
				}),
			],
		});

		expect(await listConfigured()).toEqual([expect.objectContaining({ unfinishedBlockers: ['LO-68', 'LO-69'] })]);
	});

	test('says a ticket with no relations at all is blocked by nothing', async () => {
		setupClient({ issues: [issueOf({ number: 70 })] });

		expect(await listConfigured()).toEqual([expect.objectContaining({ unfinishedBlockers: [] })]);
	});

	test('reports the issue’s own workflow status name, which is half of what a caller needs to decide it is selectable', async () => {
		setupClient({ issues: [issueOf({ number: 70, state: 'Ready to implement' })] });

		expect(await listConfigured()).toEqual([expect.objectContaining({ status: 'Ready to implement' })]);
	});

	test('fails the whole read when an issue’s workflow status cannot be read — an empty status would silently drop it from the backlog', async () => {
		setupClient({ issues: [issueOf({ number: 70, state: null })] });

		expect(await listConfigured()).toStrictEqual({ error: "Linear issue 'LO-70' has no readable workflow status" });
	});

	test('fails the whole read when a later issue has no readable status, rather than answering the tickets that did resolve', async () => {
		setupClient({ issues: [issueOf({ number: 70 }), issueOf({ number: 71, state: null })] });

		expect(await listConfigured()).toStrictEqual({ error: "Linear issue 'LO-71' has no readable workflow status" });
	});

	test('hands a tracker failure back rather than swallowing it — a bad key must not read as an empty backlog', async () => {
		mockRunLinear.mockResolvedValue({ error: 'authentication failed' });

		expect(await listConfigured()).toStrictEqual({ error: 'authentication failed' });
	});
});
