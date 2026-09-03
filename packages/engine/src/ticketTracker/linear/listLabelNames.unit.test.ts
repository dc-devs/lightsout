import { describe, expect, jest, test } from '@jest/globals';
import { listLabelNames } from '#src/ticketTracker/linear/listLabelNames.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// `runLinear` is the one place a call leaves the machine; stubbing it pins the
// filter this read asks for and the names it hands back, with no network.
type LinearCall = (client: unknown) => Promise<unknown>;

const mockRunLinear = jest.fn<(params: { apiKey: string; call: LinearCall }) => Promise<unknown>>();

jest.mock('#src/ticketTracker/linear/runLinear.ts', () => ({ runLinear: (params: { apiKey: string; call: LinearCall }) => mockRunLinear(params) }));
// -------------------------

const listConfigured = () => listLabelNames({ settings: trackerSettingsFixture() });

/** The shape the seam walks: a real connection appends the next page onto itself and answers itself. */
interface FakeConnection {
	nodes: unknown[];
	pageInfo: { hasNextPage: boolean };
	fetchNext: () => Promise<FakeConnection>;
}

/** A tracker whose catalog holds these names, optionally with the tail on a second page. */
const setupClient = ({ names, pages = 1 }: { names: string[]; pages?: number }) => {
	const filters: unknown[] = [];

	mockRunLinear.mockImplementation(({ call }) =>
		call({
			issueLabels: (variables: { filter: unknown }) => {
				filters.push(variables.filter);

				const page: FakeConnection = {
					nodes: (pages > 1 ? names.slice(0, 1) : names).map((name) => ({ name })),
					pageInfo: { hasNextPage: pages > 1 },
					fetchNext: () => {
						page.nodes = names.map((name) => ({ name }));
						page.pageInfo.hasNextPage = false;

						return Promise.resolve(page);
					},
				};

				return Promise.resolve(page);
			},
		}),
	);

	return { filters };
};

describe('Linear listLabelNames', () => {
	test('asks for the team’s labels or the workspace’s, which have no team — a workspace label the team may use is not missing', async () => {
		const { filters } = setupClient({ names: ['planning-complete'] });

		expect(await listConfigured()).toStrictEqual(['planning-complete']);
		expect(filters).toStrictEqual([{ or: [{ team: { key: { eq: 'LO' } } }, { team: { null: true } }] }]);
	});

	test('pages the catalog to exhaustion — a truncated catalog reports a configured label as missing when it exists', async () => {
		setupClient({ names: ['planning-complete', 'planning-not-needed'], pages: 2 });

		expect(await listConfigured()).toStrictEqual(['planning-complete', 'planning-not-needed']);
	});

	test('hands a tracker failure back rather than swallowing it — an unreadable catalog must never read as an empty one', async () => {
		mockRunLinear.mockResolvedValue({ error: 'authentication failed' });

		expect(await listConfigured()).toStrictEqual({ error: 'authentication failed' });
	});
});
