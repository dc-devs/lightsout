import { describe, expect, jest, test } from '@jest/globals';
import type { PlanWorkspaceView } from '@lightsout/engine';
import { planWorkspaceQueryOptions } from '#src/features/plans/index.ts';
import { buildPlanWorkspaceView } from '#tests/helpers/buildPlanWorkspaceView.ts';

// Mocked Imports
// -------------------------
// The reader, not the server function in front of it: under Jest the Start stub
// hands `handler()` straight back, so the real `getPlanWorkspaceServerFn` runs
// and only the filesystem is stood in for.
const mockGetPlanWorkspace = jest.fn<(params: { name: string }) => Promise<PlanWorkspaceView>>();

jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ getPlanWorkspace: (params: { name: string }) => mockGetPlanWorkspace(params) }),
}));
// -------------------------

const setupPlanWorkspaceQueryOptions = ({ view = buildPlanWorkspaceView() }: { view?: PlanWorkspaceView } = {}) => {
	mockGetPlanWorkspace.mockResolvedValue(view);

	const options = planWorkspaceQueryOptions({ name: 'add-search' });
	// Typed against TanStack's QueryFunctionContext generics, which the options
	// object hands nothing more than what is written here.
	const fetchWorkspace = options.queryFn as unknown as () => Promise<PlanWorkspaceView>;

	return { fetchWorkspace, options, view };
};

describe('planWorkspaceQueryOptions', () => {
	// The literals rather than `QueryKey.PlanWorkspace`: the key is the cache
	// contract, and comparing the constant to itself would pass however it were
	// spelled.
	test('keys the cache under the workspace name, so two plans are two entries', () => {
		const { options } = setupPlanWorkspaceQueryOptions();

		expect(options.queryKey).toStrictEqual(['planWorkspace', 'add-search']);
	});

	test('asks the reader for the name the URL carried', async () => {
		const { fetchWorkspace } = setupPlanWorkspaceQueryOptions();

		await fetchWorkspace();

		expect(mockGetPlanWorkspace).toHaveBeenCalledWith({ name: 'add-search' });
	});

	test('is never polled, for the reason the list is not: nothing writes here but a planning command', () => {
		const { options } = setupPlanWorkspaceQueryOptions();

		expect(options.refetchInterval).toBeUndefined();
	});
});
