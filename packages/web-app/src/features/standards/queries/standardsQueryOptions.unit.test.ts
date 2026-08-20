import { describe, expect, jest, test } from '@jest/globals';
import type { StandardsView } from '@lightsout/engine';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { standardsQueryOptions } from '#src/features/standards/index.ts';
import { buildStandardsView } from '#tests/helpers/buildStandardsView.ts';

// Mocked Imports
// -------------------------
// The reader, not the server function in front of it: under Jest the Start stub
// hands `handler()` straight back, so the real `getStandardsServerFn` runs and
// only the filesystem is stood in for.
const mockGetStandards = jest.fn<() => Promise<StandardsView>>();

jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ getStandards: () => mockGetStandards() }),
}));
// -------------------------

const setupStandardsQueryOptions = () => {
	const view = buildStandardsView();

	mockGetStandards.mockResolvedValue(view);

	const options = standardsQueryOptions();
	// Typed against TanStack's QueryFunctionContext generics, which the options
	// object hands nothing more than what is written here.
	const fetchStandards = options.queryFn as unknown as () => Promise<StandardsView>;

	return { fetchStandards, options, view };
};

describe('standardsQueryOptions', () => {
	test('keys the cache under the standards key alone, since the view covers the whole repo', () => {
		const { options } = setupStandardsQueryOptions();

		expect(options.queryKey).toStrictEqual([QueryKey.Standards]);
	});

	test('fetches through the standards server function, which reads the repo through the reader', async () => {
		const { fetchStandards, view } = setupStandardsQueryOptions();

		const standards = await fetchStandards();

		expect(standards).toStrictEqual(view);
	});

	test('is never polled, because a snapshot changes only when a person runs a check', () => {
		const { options } = setupStandardsQueryOptions();

		expect(options.refetchInterval).toBeUndefined();
	});
});
