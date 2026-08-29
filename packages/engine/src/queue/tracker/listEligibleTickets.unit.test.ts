import { describe, expect, jest, test } from '@jest/globals';
import { listEligibleTickets } from '#src/queue/tracker/index.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';

// Mocked Imports
// -------------------------
// `runLinear` is the one place a client is built and a call leaves the machine.
// Stubbing it is what lets these tests pin the filters the adapter asks for and
// the shapes it hands back, without a network or an API key.
type LinearCall = (client: unknown) => Promise<unknown>;

const mockRunLinear = jest.fn<(params: { apiKey: string; call: LinearCall }) => Promise<unknown>>();

jest.mock('#src/queue/tracker/runLinear.ts', () => ({ runLinear: (params: { apiKey: string; call: LinearCall }) => mockRunLinear(params) }));
// -------------------------

const settings = queueSettingsFixture({ eligibleStatuses: ['Backlog', 'Ready to implement'] });

/** The shape the adapter walks: a real connection appends the next page onto itself and answers itself. */
interface FakeConnection {
	nodes: unknown[];
	pageInfo: { hasNextPage: boolean };
	fetchNext: () => Promise<FakeConnection>;
}

/** One inverse relation, as the adapter reads it: a type, a source issue, and that source's workflow state. */
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
	relations = [],
	relationPages = 1,
}: {
	number: number;
	description?: string | null;
	relations?: ReturnType<typeof relationOf>[];
	relationPages?: number;
}) => ({
	id: `id-${number}`,
	identifier: `LO-${number}`,
	title: `Ticket ${number}`,
	description,
	priority: 2,
	createdAt: new Date('2026-01-01T00:00:00.000Z'),
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

/** A client whose every `issues` query answers one page of the issues the filter's label asks for. */
const setupClient = ({ byLabel, pages }: { byLabel: Record<string, unknown[]>; pages?: number }) => {
	const filters: unknown[] = [];
	let fetched = 0;

	const client = {
		issues: (variables: { filter: { labels: { name: { eq: string } } } }) => {
			filters.push(variables.filter);

			const nodes = byLabel[variables.filter.labels.name.eq] ?? [];
			// An empty page has nothing after it, so only a label that answered
			// issues is worth a second round trip.
			const pageInfo = { hasNextPage: nodes.length > 0 && (pages ?? 1) > 1 };
			const page: FakeConnection = {
				nodes,
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

describe('listEligibleTickets', () => {
	test('asks one query per route label, so the route is known from the query rather than a second round trip per ticket', async () => {
		const { filters } = setupClient({ byLabel: { 'route-direct': [issueOf({ number: 70 })], 'route-auto-plan': [issueOf({ number: 71 })] } });

		const tickets = await listEligibleTickets({ settings });

		expect(filters).toStrictEqual([
			{ team: { key: { eq: 'LO' } }, labels: { name: { eq: 'route-direct' } }, state: { name: { in: ['Backlog', 'Ready to implement'] } } },
			{ team: { key: { eq: 'LO' } }, labels: { name: { eq: 'route-auto-plan' } }, state: { name: { in: ['Backlog', 'Ready to implement'] } } },
		]);
		expect(tickets).toStrictEqual([
			{
				id: 'id-70',
				identifier: 'LO-70',
				title: 'Ticket 70',
				description: '',
				priority: 2,
				createdAt: '2026-01-01T00:00:00.000Z',
				route: 'direct',
				unfinishedBlockers: [],
			},
			{
				id: 'id-71',
				identifier: 'LO-71',
				title: 'Ticket 71',
				description: '',
				priority: 2,
				createdAt: '2026-01-01T00:00:00.000Z',
				route: 'auto-plan',
				unfinishedBlockers: [],
			},
		]);
	});

	test('carries the ticket body through verbatim, because it is the whole brief a direct worker gets', async () => {
		setupClient({ byLabel: { 'route-direct': [issueOf({ number: 70, description: '# Do the thing' })] } });

		const tickets = await listEligibleTickets({ settings });

		expect(tickets).toEqual([expect.objectContaining({ description: '# Do the thing' })]);
	});

	test('pages the connection to exhaustion — a silently truncated backlog reads as a smaller queue than exists', async () => {
		const { fetchedPages } = setupClient({ byLabel: { 'route-direct': [issueOf({ number: 70 })] }, pages: 2 });

		await listEligibleTickets({ settings });

		expect(fetchedPages()).toBe(1);
	});

	test('returns a ticket carrying both route labels once per query, leaving the skip policy to the drain', async () => {
		setupClient({ byLabel: { 'route-direct': [issueOf({ number: 70 })], 'route-auto-plan': [issueOf({ number: 70 })] } });

		const tickets = await listEligibleTickets({ settings });

		expect(tickets).toEqual([expect.objectContaining({ route: 'direct' }), expect.objectContaining({ route: 'auto-plan' })]);
	});

	test('reads a started blocking ticket as unfinished and carries its identifier, which is what holds the dependent back', async () => {
		setupClient({
			byLabel: { 'route-direct': [issueOf({ number: 70, relations: [relationOf({ type: 'blocks', blocker: 'LO-69', stateType: 'started' })] })] },
		});

		const tickets = await listEligibleTickets({ settings });

		expect(tickets).toEqual([expect.objectContaining({ unfinishedBlockers: ['LO-69'] })]);
	});

	test('reads a completed blocker as finished, because the work the dependent waited on has shipped', async () => {
		setupClient({
			byLabel: { 'route-direct': [issueOf({ number: 70, relations: [relationOf({ type: 'blocks', blocker: 'LO-69', stateType: 'completed' })] })] },
		});

		expect(await listEligibleTickets({ settings })).toEqual([expect.objectContaining({ unfinishedBlockers: [] })]);
	});

	test('reads a canceled blocker as finished too — a ticket someone gave up on must not block its dependent forever', async () => {
		setupClient({
			byLabel: { 'route-direct': [issueOf({ number: 70, relations: [relationOf({ type: 'blocks', blocker: 'LO-69', stateType: 'canceled' })] })] },
		});

		expect(await listEligibleTickets({ settings })).toEqual([expect.objectContaining({ unfinishedBlockers: [] })]);
	});

	test('keeps only the blockers that are unfinished when a ticket waits on some that have shipped and some that have not', async () => {
		setupClient({
			byLabel: {
				'route-direct': [
					issueOf({
						number: 70,
						relations: [
							relationOf({ type: 'blocks', blocker: 'LO-68', stateType: 'completed' }),
							relationOf({ type: 'blocks', blocker: 'LO-69', stateType: 'backlog' }),
						],
					}),
				],
			},
		});

		expect(await listEligibleTickets({ settings })).toEqual([expect.objectContaining({ unfinishedBlockers: ['LO-69'] })]);
	});

	test('keeps a blocker whose workflow state cannot be read — waiting one extra run beats shipping a dependent ahead of its blocker', async () => {
		setupClient({ byLabel: { 'route-direct': [issueOf({ number: 70, relations: [relationOf({ type: 'blocks', blocker: 'LO-69', stateType: null })] })] } });

		expect(await listEligibleTickets({ settings })).toEqual([expect.objectContaining({ unfinishedBlockers: ['LO-69'] })]);
	});

	test('ignores a relation whose source issue cannot be resolved at all, because a nameless block could never be satisfied', async () => {
		setupClient({ byLabel: { 'route-direct': [issueOf({ number: 70, relations: [relationOf({ type: 'blocks' })] })] } });

		expect(await listEligibleTickets({ settings })).toEqual([expect.objectContaining({ unfinishedBlockers: [] })]);
	});

	test('ignores relation types other than blocks, however unfinished their source is', async () => {
		setupClient({
			byLabel: {
				'route-direct': [
					issueOf({
						number: 70,
						relations: [
							relationOf({ type: 'related', blocker: 'LO-68', stateType: 'started' }),
							relationOf({ type: 'duplicate', blocker: 'LO-67', stateType: 'started' }),
						],
					}),
				],
			},
		});

		expect(await listEligibleTickets({ settings })).toEqual([expect.objectContaining({ unfinishedBlockers: [] })]);
	});

	test('pages the relation connection to exhaustion — a truncated relation list ships a dependent ahead of its blocker', async () => {
		setupClient({
			byLabel: {
				'route-direct': [
					issueOf({
						number: 70,
						relations: [relationOf({ type: 'blocks', blocker: 'LO-68' }), relationOf({ type: 'blocks', blocker: 'LO-69' })],
						relationPages: 2,
					}),
				],
			},
		});

		expect(await listEligibleTickets({ settings })).toEqual([expect.objectContaining({ unfinishedBlockers: ['LO-68', 'LO-69'] })]);
	});

	test('says a ticket with no relations at all is blocked by nothing', async () => {
		setupClient({ byLabel: { 'route-direct': [issueOf({ number: 70 })] } });

		expect(await listEligibleTickets({ settings })).toEqual([expect.objectContaining({ unfinishedBlockers: [] })]);
	});

	test('hands a tracker failure back rather than swallowing it — a bad key must not read as an empty backlog', async () => {
		mockRunLinear.mockResolvedValue({ error: 'authentication failed' });

		expect(await listEligibleTickets({ settings })).toStrictEqual({ error: 'authentication failed' });
	});
});
