import { describe, expect, test } from '@jest/globals';
import { type CommandCatalogEntry, commandCatalog } from '@lightsout/engine';
import { commandsQueryOptions } from '#src/features/commands/queries/commandsQueryOptions.ts';

// No mocks: under Jest the Start stub hands `handler()` straight back, so the
// real `listCommandsServerFn` runs, and what it answers is the engine's own
// catalog, which touches no disk.
const setupCommandsQueryOptions = () => {
	const options = commandsQueryOptions();
	// Typed against TanStack's QueryFunctionContext generics, which the options
	// object hands nothing more than what is written here.
	const fetchCommands = options.queryFn as unknown as () => Promise<CommandCatalogEntry[]>;

	return { fetchCommands, options };
};

describe('commandsQueryOptions', () => {
	test('keys the cache under the commands key alone, since one query carries the whole catalog', () => {
		const { options } = setupCommandsQueryOptions();

		expect(options.queryKey).toStrictEqual(['commands']);
	});

	test('fetches every entry through the server function, so the detail page needs no second round trip', async () => {
		const { fetchCommands } = setupCommandsQueryOptions();

		const commands = await fetchCommands();

		expect(commands).toStrictEqual(commandCatalog);
	});

	test('is never polled, because the catalog is engine source rather than repo state', () => {
		const { options } = setupCommandsQueryOptions();

		expect(options.refetchInterval).toBeUndefined();
	});
});
