import { expect, test, jest } from '@jest/globals';
import { getRequiredFlag } from '@/cli/common/args/getRequiredFlag';
import { parseFlags } from '@/cli/common/args/parseFlags';

// A missing required flag ends the process, so the arrangement captures both
// halves of that response: the usage text on stderr and the exit itself. The
// real process.exit never returns — a mock that returned would let
// getRequiredFlag fall through and hand back the value it promised never to.
// `t.mock.method` restores both originals when the test ends.
const setupRequiredFlag = ({ args }: { args: string[] }) => {
	const errors: string[] = [];
	const exitCodes: (number | string | null | undefined)[] = [];

	jest.spyOn(console, 'error').mockImplementation((...params: unknown[]) => {
		errors.push(String(params[0]));
	});

	jest.spyOn(process, 'exit').mockImplementation((code?: number | string | null): never => {
		exitCodes.push(code);

		throw new Error('process.exit');
	});

	return { flags: parseFlags({ args }), errors, exitCodes };
};

test('getRequiredFlag: returns the value and stays quiet when the flag carries one', () => {
	const { flags, errors, exitCodes } = setupRequiredFlag({ args: ['--plan', 'plans/feature.md', '--cwd', '/repo'] });

	const value = getRequiredFlag({ flags, name: 'plan' });

	expect(value).toBe('plans/feature.md');
	expect(errors).toStrictEqual([]);
	expect(exitCodes).toStrictEqual([]);
});

test('getRequiredFlag: an absent flag prints the usage text on stderr and exits 1 instead of returning', () => {
	const { flags, errors, exitCodes } = setupRequiredFlag({ args: ['--cwd', '/repo'] });

	expect(() => getRequiredFlag({ flags, name: 'plan' })).toThrow(/process\.exit/);

	expect(exitCodes).toStrictEqual([1]);
	expect(errors.length).toBe(1);
	expect(errors[0] ?? '').toMatch(/^lightsout — deterministic engine for coding agents/);
	expect(errors[0] ?? '').toMatch(/lightsout implement --plan <path>/);
});

test('getRequiredFlag: a flag given with no value is boolean, not a value — it fails the same way', () => {
	const { flags, errors, exitCodes } = setupRequiredFlag({ args: ['--plan', '--cwd', '/repo'] });

	expect(() => getRequiredFlag({ flags, name: 'plan' })).toThrow(/process\.exit/);

	expect(exitCodes).toStrictEqual([1]);
	expect(errors.length).toBe(1);
});

test('getRequiredFlag: an empty string is a present-but-empty flag and is rejected too', () => {
	const { flags, exitCodes } = setupRequiredFlag({ args: ['--plan', '', '--cwd', '/repo'] });

	expect(() => getRequiredFlag({ flags, name: 'plan' })).toThrow(/process\.exit/);

	expect(exitCodes).toStrictEqual([1]);
});
