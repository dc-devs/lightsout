import { expect, test } from '@jest/globals';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { runCli } from '#tests/helpers/runCli.ts';
import { usageStderr } from '#tests/helpers/usageStderr.ts';

// `brainstorm` is a command word only once the dispatch table routes it, so
// these run the built CLI as a subprocess: a unit test on the handler would
// pass while `lightsout brainstorm` still fell through to the unknown-command
// usage error. Each case stops before the tracker is reached — a missing
// --name, an unknown subcommand and an unrejected flag are all answered by the
// argv layer — so an empty temp repo with no lightsout.config.json is enough.

test('cli: brainstorm publish without --name prints usage to stderr and exits 1', async () => {
	const cwd = await freshCwd();

	const { stdout, stderr, code } = await runCli({ args: ['brainstorm', 'publish', '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toBe(usageStderr);
	expect(code).toBe(1);
});

test('cli: brainstorm with an unknown subcommand prints usage to stderr and exits 1', async () => {
	const cwd = await freshCwd();

	const { stdout, stderr, code } = await runCli({ args: ['brainstorm', 'nonsense', '--name', 'demo', '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toBe(usageStderr);
	expect(code).toBe(1);
});

// The accepted flag set is checked against the command word in main, before
// `brainstorm` is entered at all, so the message names `brainstorm` rather
// than `brainstorm publish`.
test('cli: brainstorm publish with an unknown flag names it and exits 1', async () => {
	const cwd = await freshCwd();

	const { stdout, stderr, code } = await runCli({ args: ['brainstorm', 'publish', '--name', 'demo', '--notes', 'rough.md', '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toBe(`lightsout brainstorm: unknown flag --notes\n\n${usageStderr}`);
	expect(code).toBe(1);
});
