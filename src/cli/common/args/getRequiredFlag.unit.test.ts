import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { getRequiredFlag } from '@/cli/common/args/getRequiredFlag';
import { parseFlags } from '@/cli/common/args/parseFlags';

// A missing required flag ends the process, so the arrangement captures both
// halves of that response: the usage text on stderr and the exit itself. The
// real process.exit never returns — a mock that returned would let
// getRequiredFlag fall through and hand back the value it promised never to.
// `t.mock.method` restores both originals when the test ends.
const setupRequiredFlag = ({ t, args }: { t: TestContext; args: string[] }) => {
	const errors: string[] = [];
	const exitCodes: (number | string | null | undefined)[] = [];

	t.mock.method(console, 'error', (...params: unknown[]) => {
		errors.push(String(params[0]));
	});

	t.mock.method(process, 'exit', (code?: number | string | null): never => {
		exitCodes.push(code);

		throw new Error('process.exit');
	});

	return { flags: parseFlags({ args }), errors, exitCodes };
};

test('getRequiredFlag: returns the value and stays quiet when the flag carries one', (t) => {
	const { flags, errors, exitCodes } = setupRequiredFlag({ t, args: ['--plan', 'plans/feature.md', '--cwd', '/repo'] });

	const value = getRequiredFlag({ flags, name: 'plan' });

	assert.equal(value, 'plans/feature.md');
	assert.deepEqual(errors, []);
	assert.deepEqual(exitCodes, []);
});

test('getRequiredFlag: an absent flag prints the usage text on stderr and exits 1 instead of returning', (t) => {
	const { flags, errors, exitCodes } = setupRequiredFlag({ t, args: ['--cwd', '/repo'] });

	assert.throws(() => getRequiredFlag({ flags, name: 'plan' }), /process\.exit/);

	assert.deepEqual(exitCodes, [1]);
	assert.equal(errors.length, 1);
	assert.match(errors[0] ?? '', /^lightsout — deterministic engine for coding agents/);
	assert.match(errors[0] ?? '', /lightsout implement --plan <path>/);
});

test('getRequiredFlag: a flag given with no value is boolean, not a value — it fails the same way', (t) => {
	const { flags, errors, exitCodes } = setupRequiredFlag({ t, args: ['--plan', '--cwd', '/repo'] });

	assert.throws(() => getRequiredFlag({ flags, name: 'plan' }), /process\.exit/);

	assert.deepEqual(exitCodes, [1]);
	assert.equal(errors.length, 1);
});

test('getRequiredFlag: an empty string is a present-but-empty flag and is rejected too', (t) => {
	const { flags, exitCodes } = setupRequiredFlag({ t, args: ['--plan', '', '--cwd', '/repo'] });

	assert.throws(() => getRequiredFlag({ flags, name: 'plan' }), /process\.exit/);

	assert.deepEqual(exitCodes, [1]);
});
