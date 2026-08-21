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
