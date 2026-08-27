import { describe, expect, jest, test } from '@jest/globals';
import type { CommandCatalogEntry } from '@lightsout/engine';
import { commandsQueryOptions } from '#src/features/commands/index.ts';
import { buildCommandCatalogEntry } from '#tests/helpers/buildCommandCatalogEntry.ts';

// Mocked Imports
// -------------------------
// The reader, not the server function in front of it: under Jest the Start stub
// hands `handler()` straight back, so the real `listCommandsServerFn` runs and
// only the engine behind it is stood in for.
const mockListCommands = jest.fn<() => Promise<CommandCatalogEntry[]>>();

jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ listCommands: () => mockListCommands() }),
}));
// -------------------------

const setupCommandsQueryOptions = () => {
	const catalog = [buildCommandCatalogEntry(), buildCommandCatalogEntry({ id: 'doctor', slash: undefined, cli: 'lightsout doctor' })];

	mockListCommands.mockResolvedValue(catalog);

	const options = commandsQueryOptions();
	// Typed against TanStack's QueryFunctionContext generics, which the options
	// object hands nothing more than what is written here.
	const fetchCommands = options.queryFn as unknown as () => Promise<CommandCatalogEntry[]>;

	return { catalog, fetchCommands, options };
};

describe('commandsQueryOptions', () => {
	test('keys the cache under the commands key alone, since one query carries the whole catalog', () => {
		const { options } = setupCommandsQueryOptions();

		expect(options.queryKey).toStrictEqual(['commands']);
	});

	test('fetches every entry through the server function, so the detail page needs no second round trip', async () => {
		const { catalog, fetchCommands } = setupCommandsQueryOptions();

		const commands = await fetchCommands();

		expect(commands).toStrictEqual(catalog);
	});

	test('is never polled, because the catalog is engine source rather than repo state', () => {
		const { options } = setupCommandsQueryOptions();

		expect(options.refetchInterval).toBeUndefined();
	});
});
