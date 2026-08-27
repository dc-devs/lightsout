import { expect, test } from '@jest/globals';
import { getUnknownFlagsMessage } from '#src/cli/common/args/getUnknownFlagsMessage.ts';

const messageFor = ({ command, names }: { command: string; names: string[] }) =>
	getUnknownFlagsMessage({ command, flags: new Map(names.map((name) => [name, true as const])) });

test('getUnknownFlagsMessage: says nothing when every flag belongs to the command', () => {
	expect(messageFor({ command: 'standards-check', names: ['code-checks', 'all', 'cwd'] })).toBeUndefined();
	expect(messageFor({ command: 'refactor', names: [] })).toBeUndefined();
});

test('getUnknownFlagsMessage: names the misspelt flag that used to run the whole check in silence', () => {
	expect(messageFor({ command: 'standards-check', names: ['code-check'] })).toBe('lightsout standards-check: unknown flag --code-check');
});

test('getUnknownFlagsMessage: lists every offending flag, and only those', () => {
	expect(messageFor({ command: 'status', names: ['cwd', 'baseline', 'all'] })).toBe('lightsout status: unknown flags --baseline, --all');
});

test('getUnknownFlagsMessage: rejects a flag that belongs to a different command', () => {
	expect(messageFor({ command: 'doctor', names: ['plan'] })).toBe('lightsout doctor: unknown flag --plan');
});

test('getUnknownFlagsMessage: accepts every shape flags at once, since a command is one accepted set and not one per usage line', () => {
	expect(messageFor({ command: 'implement', names: ['plan', 'overview', 'packages', 'start-phase', 'skip-refactor', 'cwd'] })).toBeUndefined();
	expect(messageFor({ command: 'refactor', names: ['run', 'all', 'max-batches', 'allow-dirty'] })).toBeUndefined();
});

test('getUnknownFlagsMessage: a flag written twice with two placeholders is still one accepted flag', () => {
	expect(messageFor({ command: 'implement', names: ['plan'] })).toBeUndefined();
});

test('getUnknownFlagsMessage: a command with no flags of its own still takes --cwd, and nothing else', () => {
	expect(messageFor({ command: 'brainstorm', names: ['cwd'] })).toBeUndefined();
	expect(messageFor({ command: 'brainstorm', names: ['notes'] })).toBe('lightsout brainstorm: unknown flag --notes');
});

test('getUnknownFlagsMessage: a command name nothing answers to accepts --cwd and rejects the rest', () => {
	expect(messageFor({ command: 'nonesuch', names: ['cwd'] })).toBeUndefined();
	expect(messageFor({ command: 'nonesuch', names: ['plan', 'all'] })).toBe('lightsout nonesuch: unknown flags --plan, --all');
});

test('getUnknownFlagsMessage: standards-validate takes --pack, and the retired --package spelling is a usage error', () => {
	expect(messageFor({ command: 'standards-validate', names: ['pack'] })).toBeUndefined();
	expect(messageFor({ command: 'standards-validate', names: ['package'] })).toBe('lightsout standards-validate: unknown flag --package');
});
