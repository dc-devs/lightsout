import { describe, expect, jest, test } from '@jest/globals';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import { setTicketStatus } from '#src/queue/tracker/index.ts';

// Mocked Imports
// -------------------------
// `runLinear` is the one place a call leaves the machine; stubbing it pins the
// two calls this write makes and what it does when the status does not exist.
type LinearCall = (client: unknown) => Promise<unknown>;

const mockRunLinear = jest.fn<(params: { apiKey: string; call: LinearCall }) => Promise<unknown>>();

jest.mock('#src/queue/tracker/runLinear.ts', () => ({ runLinear: (params: { apiKey: string; call: LinearCall }) => mockRunLinear(params) }));
// -------------------------

const settings: QueueSettings = {
	team: 'LO',
	routeLabels: { direct: 'route-direct', 'auto-plan': 'route-auto-plan' },
	maxParallel: 1,
	apiKey: 'lin_key',
	eligibleStatuses: ['Backlog'],
	inProgressStatus: 'In Progress',
	branchTemplate: '{ticket}-{slug}',
	decisionsHeading: '## Decisions',
	workerMinutes: 240,
};

const setupClient = ({ states }: { states: { id: string; name: string }[] }) => {
	const stateFilters: unknown[] = [];
	const updates: { id: string; input: unknown }[] = [];

	mockRunLinear.mockImplementation(({ call }) =>
		call({
			workflowStates: (variables: { filter: unknown }) => {
				stateFilters.push(variables.filter);

				return Promise.resolve({ nodes: states });
			},
			updateIssue: (id: string, input: unknown) => {
				updates.push({ id, input });

				return Promise.resolve({ success: true });
			},
		}),
	);

	return { stateFilters, updates };
};

describe('setTicketStatus', () => {
	test('resolves the team’s state by name and moves the issue to it, answering undefined the way every other write step does', async () => {
		const { stateFilters, updates } = setupClient({ states: [{ id: 'state-1', name: 'In Progress' }] });

		const failure = await setTicketStatus({ settings, ticketId: 'id-70', statusName: 'In Progress' });

		expect(failure).toBeUndefined();
		expect(stateFilters).toStrictEqual([{ team: { key: { eq: 'LO' } }, name: { eq: 'In Progress' } }]);
		expect(updates).toStrictEqual([{ id: 'id-70', input: { stateId: 'state-1' } }]);
	});

	test('names a status the team does not have, rather than passing as a silent no-op', async () => {
		const { updates } = setupClient({ states: [] });

		expect(await setTicketStatus({ settings, ticketId: 'id-70', statusName: 'Shipping' })).toStrictEqual({ error: "the 'LO' team has no 'Shipping' status" });
		expect(updates).toStrictEqual([]);
	});

	test('hands a tracker failure back untouched', async () => {
		mockRunLinear.mockResolvedValue({ error: 'the tracker did not answer' });

		expect(await setTicketStatus({ settings, ticketId: 'id-70', statusName: 'In Progress' })).toStrictEqual({ error: 'the tracker did not answer' });
	});
});
