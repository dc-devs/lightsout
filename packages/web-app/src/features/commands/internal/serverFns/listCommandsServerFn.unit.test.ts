import { afterEach, describe, expect, test } from '@jest/globals';
import { listCommandsServerFn } from '#src/features/commands/internal/serverFns/listCommandsServerFn.ts';

/** Every command the catalog names, in page order — spelled out here so a dropped command fails this suite rather than quietly agreeing with it. */
const commandIds = [
	'brainstorm',
	'plan',
	'auto-plan',
	'implement',
	'implement-direct',
	'resume',
	'ship',
	'queue',
	'work-order',
	'ticket-state',
	'self-check',
	'refactor',
	'test-coverage-to-threshold',
	'standards-check',
	'standards-validate',
	'standards-health',
	'status',
	'report',
	'doctor',
	'friction',
	'improve',
	'voice',
];
/** Under Jest the Start stub hands `handler()` straight back, so this is the real handler. */
const setupListCommands = ({ publicSite = false }: { publicSite?: boolean } = {}) => {
	if (publicSite) {
		process.env.LIGHTSOUT_PUBLIC = '1';
	}

	return { listCommands: listCommandsServerFn as unknown as () => Promise<Array<{ id: string }>> };
};

afterEach(() => {
	delete process.env.LIGHTSOUT_PUBLIC;
});

describe('listCommandsServerFn', () => {
	test('answers the whole command catalog, in page order', async () => {
		const { listCommands } = setupListCommands();

		const commands = await listCommands();

		expect(commands.map((command) => command.id)).toStrictEqual(commandIds);
	});

	test('answers on the public site too, since the catalog is engine source rather than repo state', async () => {
		const { listCommands } = setupListCommands({ publicSite: true });

		const commands = await listCommands();

		expect(commands.map((command) => command.id)).toStrictEqual(commandIds);
	});
});
