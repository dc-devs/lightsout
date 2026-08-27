import { describe, expect, jest, test } from '@jest/globals';
import { ConfigNotFoundError, type ConfigView } from '@lightsout/engine';
import { configQueryOptions } from '#src/features/config/index.ts';
import { buildConfigView } from '#tests/helpers/buildConfigView.ts';

// Mocked Imports
// -------------------------
// The reader, not the server function in front of it. Under Jest the Start stub
// hands `handler()` straight back, so the real `getConfigServerFn` runs and the
// fetcher is proved all the way down to the seam the app is allowed to stub.
const mockGetConfig = jest.fn<() => Promise<ConfigView>>();

jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ getConfig: () => mockGetConfig() }),
}));
// -------------------------

const setupConfigQueryOptions = ({ rejection, view = buildConfigView() }: { rejection?: Error; view?: ConfigView } = {}) => {
	if (rejection === undefined) {
		mockGetConfig.mockResolvedValue(view);
	} else {
		mockGetConfig.mockRejectedValue(rejection);
	}

	const options = configQueryOptions();
	// Typed against TanStack's QueryFunctionContext generics, which the options
	// object hands nothing more than what is written here.
	const fetchConfig = options.queryFn as unknown as () => Promise<ConfigView>;

	return { fetchConfig, options, view };
};

describe('configQueryOptions', () => {
	// The literal rather than `QueryKey.Config`: the key is the cache contract the
	// config page and the health strip have to agree on, and comparing the
	// constant to itself would pass however it were spelled.
	test('keys the cache under the config key alone, since one query carries the whole file', () => {
		const { options } = setupConfigQueryOptions();

		expect(options.queryKey).toStrictEqual(['config']);
	});

	test('fetches the resolved config through the server function, which reads the repo through the reader', async () => {
		const { fetchConfig, view } = setupConfigQueryOptions({ view: buildConfigView({ overrides: { path: '/repos/other/lightsout.config.json' } }) });

		const config = await fetchConfig();

		expect(config).toStrictEqual(view);
	});

	test("turns a repo with no config file into the router's own not-found signal, because the page is about a file that is not there", async () => {
		const { fetchConfig } = setupConfigQueryOptions({ rejection: new ConfigNotFoundError({ configPath: '/repos/lightsout/lightsout.config.json' }) });

		await expect(fetchConfig()).rejects.toStrictEqual({ isNotFound: true });
	});

	test('lets a config that will not parse travel as itself, so the message naming the bad key survives the trip', async () => {
		const { fetchConfig } = setupConfigQueryOptions({ rejection: new Error('gates: expected object, received string') });

		await expect(fetchConfig()).rejects.toThrow('gates: expected object, received string');
	});

	test('is never polled, because the file changes only when someone edits it on disk', () => {
		const { options } = setupConfigQueryOptions();

		expect(options.refetchInterval).toBeUndefined();
	});
});
