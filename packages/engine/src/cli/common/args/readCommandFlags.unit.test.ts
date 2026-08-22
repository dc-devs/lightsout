import { expect, test } from '@jest/globals';
import { readCommandFlags } from '#src/cli/common/args/readCommandFlags.ts';

test('readCommandFlags: reads a command flags from the usage text, unioned across the lines that describe it', () => {
	const flags = readCommandFlags({ command: 'refactor' });

	expect([...flags].sort()).toStrictEqual(['all', 'allow-dirty', 'code-checks', 'cwd', 'max-batches', 'path', 'run']);
});

test('readCommandFlags: allows --cwd everywhere, since the dispatcher reads it before it knows the command', () => {
	expect(readCommandFlags({ command: 'status' })).toStrictEqual(new Set(['cwd']));
	expect(readCommandFlags({ command: 'friction' })).toStrictEqual(new Set(['cwd']));
});

test('readCommandFlags: keeps one command flags out of another', () => {
	expect(readCommandFlags({ command: 'doctor' }).has('plan')).toBe(false);
	expect(readCommandFlags({ command: 'implement' }).has('plan')).toBe(true);
});

test('readCommandFlags: gathers every subcommand flags under the command that dispatches them', () => {
	const flags = readCommandFlags({ command: 'plan' });

	expect([...flags].sort()).toStrictEqual(['cwd', 'name', 'notes', 'scope']);
});

test('readCommandFlags: a name the usage text never mentions accepts nothing beyond --cwd', () => {
	expect(readCommandFlags({ command: 'nonesuch' })).toStrictEqual(new Set(['cwd']));
});

test('readCommandFlags: standards-validate accepts --pack, and the removed --package spelling is not in the set', () => {
	const flags = readCommandFlags({ command: 'standards-validate' });

	expect([...flags].sort()).toStrictEqual(['cwd', 'pack']);
});
