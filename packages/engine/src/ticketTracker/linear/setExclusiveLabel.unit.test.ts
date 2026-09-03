import { describe, expect, jest, test } from '@jest/globals';
import { setExclusiveLabel } from '#src/ticketTracker/linear/setExclusiveLabel.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// `runLinear` is the one place a call leaves the machine. The stub mirrors its
// contract rather than only forwarding: it turns a rejection into a
// `TrackerFailure`, which is what the rollback path below depends on.
type LinearCall = (client: unknown) => Promise<unknown>;

const mockRunLinear = jest.fn<(params: { apiKey: string; call: LinearCall }) => Promise<unknown>>();

jest.mock('#src/ticketTracker/linear/runLinear.ts', () => ({ runLinear: (params: { apiKey: string; call: LinearCall }) => mockRunLinear(params) }));
// -------------------------

const settings = trackerSettingsFixture();
const groupLabels = ['planning-complete', 'planning-needs-plan'];

const setExclusive = () => setExclusiveLabel({ settings, ticketId: 'id-70', label: 'planning-complete', groupLabels });

/** The shape the seam walks: a real connection appends the next page onto itself and answers itself. */
interface FakeConnection {
	nodes: unknown[];
	pageInfo: { hasNextPage: boolean };
	fetchNext: () => Promise<FakeConnection>;
}

/** A connection whose tail sits on a second page, so a walker that stops early is visibly wrong. */
const connectionOf = ({ nodes, pages }: { nodes: unknown[]; pages: number }) => {
	const page: FakeConnection = {
		nodes: pages > 1 ? nodes.slice(0, 1) : nodes,
		pageInfo: { hasNextPage: pages > 1 },
		fetchNext: () => {
			page.nodes = nodes;
			page.pageInfo.hasNextPage = false;

			return Promise.resolve(page);
		},
	};

	return page;
};

/** A tracker whose catalog holds these labels and whose issue carries these, recording every write in order. */
const setupClient = ({
	catalog,
	carried,
	catalogPages = 1,
	carriedPages = 1,
	addFails = false,
	rollbackFails = false,
}: {
	catalog: { id: string; name: string; teamId?: string }[];
	carried: { id: string; name: string }[];
	catalogPages?: number;
	carriedPages?: number;
	addFails?: boolean;
	/** Refuse the re-add the rollback makes too, so the caller still has to be told about the first refusal. */
	rollbackFails?: boolean;
}) => {
	const filters: unknown[] = [];
	const issuesRead: string[] = [];
	const writes: string[] = [];
	let adds = 0;

	const client = {
		issueLabels: (variables: { filter: unknown }) => {
			filters.push(variables.filter);

			return Promise.resolve(connectionOf({ nodes: catalog, pages: catalogPages }));
		},
		issue: (id: string) => {
			issuesRead.push(id);

			return Promise.resolve({ labels: () => Promise.resolve(connectionOf({ nodes: carried, pages: carriedPages })) });
		},
		issueAddLabel: (id: string, labelId: string) => {
			adds += 1;
			writes.push(`add ${id} ${labelId}`);

			if (addFails && (adds === 1 || rollbackFails)) {
				return Promise.reject(new Error(adds === 1 ? 'the tracker refused the label' : 'the tracker refused the rollback'));
			}

			return Promise.resolve({ success: true });
		},
		issueRemoveLabel: (id: string, labelId: string) => {
			writes.push(`remove ${id} ${labelId}`);

			return Promise.resolve({ success: true });
		},
	};

	mockRunLinear.mockImplementation(async ({ call }) => {
		try {
			return await call(client);
		} catch (error) {
			return { error: error instanceof Error ? error.message : String(error) };
		}
	});

	return { filters, issuesRead, writes };
};

describe('Linear setExclusiveLabel', () => {
	test('removes the sibling the ticket carried and then adds the target, in that order', async () => {
		const { issuesRead, writes } = setupClient({
			catalog: [{ id: 'label-complete', name: 'planning-complete' }],
			carried: [{ id: 'label-needs-plan', name: 'planning-needs-plan' }],
		});

		expect(await setExclusive()).toBeUndefined();

		expect(issuesRead).toStrictEqual(['id-70']);
		expect(writes).toStrictEqual(['remove id-70 label-needs-plan', 'add id-70 label-complete']);
	});

	test('asks for the group by name, scoped to the team’s labels or the workspace’s, which have no team', async () => {
		const { filters } = setupClient({ catalog: [{ id: 'label-complete', name: 'planning-complete' }], carried: [] });

		await setExclusive();

		expect(filters).toStrictEqual([{ name: { in: groupLabels }, or: [{ team: { key: { eq: 'LO' } } }, { team: { null: true } }] }]);
	});

	test('writes nothing at all when the ticket already carries exactly the target', async () => {
		const { writes } = setupClient({
			catalog: [{ id: 'label-complete', name: 'planning-complete' }],
			carried: [{ id: 'label-complete', name: 'planning-complete' }],
		});

		expect(await setExclusive()).toBeUndefined();
		expect(writes).toStrictEqual([]);
	});

	test('leaves a label outside the group alone — the group is the only thing this write owns', async () => {
		const { writes } = setupClient({
			catalog: [{ id: 'label-complete', name: 'planning-complete' }],
			carried: [
				{ id: 'label-bug', name: 'bug' },
				{ id: 'label-needs-plan', name: 'planning-needs-plan' },
			],
		});

		await setExclusive();

		expect(writes).toStrictEqual(['remove id-70 label-needs-plan', 'add id-70 label-complete']);
	});

	test('names the team and the label it could not find, rather than creating one behind the caller’s back', async () => {
		const { writes } = setupClient({ catalog: [{ id: 'label-needs-plan', name: 'planning-needs-plan' }], carried: [] });

		expect(await setExclusive()).toStrictEqual({ error: "the 'LO' team has no 'planning-complete' label" });
		expect(writes).toStrictEqual([]);
	});

	test('prefers a team-scoped label over a workspace-level one of the same name, so two runs never add different ids', async () => {
		const { writes } = setupClient({
			catalog: [
				{ id: 'label-workspace', name: 'planning-complete' },
				{ id: 'label-team', name: 'planning-complete', teamId: 'team-lo' },
			],
			carried: [],
		});

		await setExclusive();

		expect(writes).toStrictEqual(['add id-70 label-team']);
	});

	test('pages the catalog to exhaustion, so a label on a second page never reads as one the team does not have', async () => {
		const { writes } = setupClient({
			catalog: [
				{ id: 'label-needs-plan', name: 'planning-needs-plan' },
				{ id: 'label-complete', name: 'planning-complete' },
			],
			carried: [],
			catalogPages: 2,
		});

		expect(await setExclusive()).toBeUndefined();
		expect(writes).toStrictEqual(['add id-70 label-complete']);
	});

	test('pages the issue’s own labels to exhaustion — a truncated list would leave a sibling planning status in place', async () => {
		const { writes } = setupClient({
			catalog: [{ id: 'label-complete', name: 'planning-complete' }],
			carried: [
				{ id: 'label-bug', name: 'bug' },
				{ id: 'label-needs-plan', name: 'planning-needs-plan' },
			],
			carriedPages: 2,
		});

		await setExclusive();

		expect(writes).toStrictEqual(['remove id-70 label-needs-plan', 'add id-70 label-complete']);
	});

	test('puts the siblings back when the add is refused, rather than leaving the ticket carrying no member of the group', async () => {
		const { writes } = setupClient({
			catalog: [{ id: 'label-complete', name: 'planning-complete' }],
			carried: [{ id: 'label-needs-plan', name: 'planning-needs-plan' }],
			addFails: true,
		});

		expect(await setExclusive()).toStrictEqual({ error: 'the tracker refused the label' });
		expect(writes).toStrictEqual(['remove id-70 label-needs-plan', 'add id-70 label-complete', 'add id-70 label-needs-plan']);
	});

	test('takes the sibling off a ticket already carrying the target too, without adding a label it already has', async () => {
		const { writes } = setupClient({
			catalog: [{ id: 'label-complete', name: 'planning-complete' }],
			carried: [
				{ id: 'label-complete', name: 'planning-complete' },
				{ id: 'label-needs-plan', name: 'planning-needs-plan' },
			],
		});

		expect(await setExclusive()).toBeUndefined();
		expect(writes).toStrictEqual(['remove id-70 label-needs-plan']);
	});

	test('reports the refusal that broke the write, not the one from the rollback that tried to undo it', async () => {
		const { writes } = setupClient({
			catalog: [{ id: 'label-complete', name: 'planning-complete' }],
			carried: [{ id: 'label-needs-plan', name: 'planning-needs-plan' }],
			addFails: true,
			rollbackFails: true,
		});

		expect(await setExclusive()).toStrictEqual({ error: 'the tracker refused the label' });
		expect(writes).toStrictEqual(['remove id-70 label-needs-plan', 'add id-70 label-complete', 'add id-70 label-needs-plan']);
	});

	test('hands a tracker failure back untouched', async () => {
		mockRunLinear.mockResolvedValue({ error: 'the tracker did not answer' });

		expect(await setExclusive()).toStrictEqual({ error: 'the tracker did not answer' });
	});
});
