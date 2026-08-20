import { describe, expect, jest, test } from '@jest/globals';
import type { PlanDocument } from '@lightsout/engine';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { planQueryOptions } from '#src/features/runDetail/index.ts';

// Mocked Imports
// -------------------------
// The reader, for the same reason the run query's test mocks it: the real
// server function runs under the Start stub, and the filesystem is the only
// seam stood in for.
const mockGetPlan = jest.fn<(params: { path: string }) => Promise<PlanDocument>>();

jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ getPlan: (params: { path: string }) => mockGetPlan(params) }),
}));
// -------------------------

const path = '.lightsout/plans/add-search.md';

const setupPlanQueryOptions = () => {
	mockGetPlan.mockResolvedValue({ path, kind: 'markdown', text: '# Add search\n' });

	const options = planQueryOptions({ path });
	// Typed against TanStack's QueryFunctionContext generics, which the options
	// object hands nothing more than what is written here.
	const fetchPlan = options.queryFn as unknown as () => Promise<PlanDocument>;

	return { fetchPlan, options };
};

describe('planQueryOptions', () => {
	test('keys the cache under the plan key and the path, so two plans never share a cache entry', () => {
		const { options } = setupPlanQueryOptions();

		expect(options.queryKey).toStrictEqual([QueryKey.Plan, path]);
	});

	test('fetches through the plan server function, which reads the repo through the reader', async () => {
		const { fetchPlan } = setupPlanQueryOptions();

		const plan = await fetchPlan();

		expect(plan).toStrictEqual({ path, kind: 'markdown', text: '# Add search\n' });
	});

	test('never goes stale, because a plan file does not change under a run that has already read it', () => {
		const { options } = setupPlanQueryOptions();

		expect(options.staleTime).toBe(Number.POSITIVE_INFINITY);
	});
});
