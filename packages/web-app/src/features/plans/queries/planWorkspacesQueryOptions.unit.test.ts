import { describe, expect, jest, test } from '@jest/globals';
import type { PlanWorkspaceListing } from '@lightsout/engine';
import { planWorkspacesQueryOptions } from '#src/features/plans/index.ts';
import { buildPlanWorkspaceListing } from '#tests/helpers/buildPlanWorkspaceListing.ts';

// Mocked Imports
// -------------------------
// The reader, not the server function in front of it: under Jest the Start stub
// hands `handler()` straight back, so the real `listPlanWorkspacesServerFn`
// runs and only the filesystem is stood in for.
const mockListPlanWorkspaces = jest.fn<() => Promise<PlanWorkspaceListing[]>>();

jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ listPlanWorkspaces: () => mockListPlanWorkspaces() }),
}));
// -------------------------

const setupPlanWorkspacesQueryOptions = ({ plans = [buildPlanWorkspaceListing({ name: 'add-search' })] }: { plans?: PlanWorkspaceListing[] } = {}) => {
	mockListPlanWorkspaces.mockResolvedValue(plans);

	const options = planWorkspacesQueryOptions();
	// Typed against TanStack's QueryFunctionContext generics, which the options
	// object hands nothing more than what is written here.
	const fetchPlans = options.queryFn as unknown as () => Promise<PlanWorkspaceListing[]>;

	return { fetchPlans, options, plans };
};

describe('planWorkspacesQueryOptions', () => {
	// The literal rather than `QueryKey.PlanWorkspaces`: the key is the cache
	// contract the plans page, the health tile and two command cards have to agree
	// on, and comparing the constant to itself would pass however it were spelled.
	test('keys the cache under the plans key alone, since the whole list is one answer', () => {
		const { options } = setupPlanWorkspacesQueryOptions();

		expect(options.queryKey).toStrictEqual(['planWorkspaces']);
	});

	test('fetches through the plans server function, which reads the repo through the reader', async () => {
		const { fetchPlans } = setupPlanWorkspacesQueryOptions();

		const plans = await fetchPlans();

		expect(plans.map((plan) => plan.name)).toStrictEqual(['add-search']);
	});

	test('is never polled, because a workspace changes only when someone runs a planning command', () => {
		const { options } = setupPlanWorkspacesQueryOptions();

		expect(options.refetchInterval).toBeUndefined();
	});
});
