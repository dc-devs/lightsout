import { describe, expect, jest, test } from '@jest/globals';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { repoRootQueryOptions } from '#src/features/app/index.ts';

// Mocked Imports
// -------------------------
// The filesystem walk, not the server function in front of it. Under Jest the
// Start stub hands `handler()` straight back, so the real `getRepoRootServerFn`
// runs and the fetcher is proved down to the one thing that touches disk. What
// the transport does with that handler is the build's business.
const mockFindRepoRoot = jest.fn<() => string | undefined>();

jest.mock('#src/common/utils/findRepoRoot.ts', () => ({
	findRepoRoot: () => mockFindRepoRoot(),
}));
// -------------------------

const setupRepoRootQueryOptions = ({ found = true }: { found?: boolean } = {}) => {
	mockFindRepoRoot.mockReturnValue(found ? '/repos/lightsout' : undefined);

	const options = repoRootQueryOptions();
	// TanStack types the fetcher against its own QueryFunctionContext generic;
	// this one takes no context, and restating that generic would add noise.
	const fetchRepoRoot = options.queryFn as unknown as () => Promise<{ repoRoot: string | undefined }>;

	return { fetchRepoRoot, options };
};

describe('repoRootQueryOptions', () => {
	test('keys the cache under the repo-root key', () => {
		const { options } = setupRepoRootQueryOptions();

		expect(options.queryKey).toStrictEqual([QueryKey.RepoRoot]);
	});

	test('fetches through the repo-root server function', async () => {
		const { fetchRepoRoot } = setupRepoRootQueryOptions();

		const result = await fetchRepoRoot();

		expect(result).toStrictEqual({ repoRoot: '/repos/lightsout' });
	});

	test('carries an absent repo through as undefined, which is what the shell reads', async () => {
		const { fetchRepoRoot } = setupRepoRootQueryOptions({ found: false });

		const result = await fetchRepoRoot();

		expect(result).toStrictEqual({ repoRoot: undefined });
	});
});
