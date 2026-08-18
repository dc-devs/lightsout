import { expect, test } from '@jest/globals';
import { freshCwd } from '@tests/helpers/freshCwd';
import { runCli } from '@tests/helpers/runCli';
import { usageStderr } from '@tests/helpers/usageStderr';

// The dispatch table's fall-through: every argv the CLI answers with the usage
// block. A removed command and a removed subcommand are pinned here too — they
// must read as unknown, never as a silent no-op.

test('cli: no args prints usage to stderr and exits 0', async () => {
	const { stdout, stderr, code } = await runCli({ args: [] });

	expect(stdout).toBe('');
	expect(stderr).toBe(usageStderr);
	expect(code).toBe(0);
});

test('cli: help prints usage to stderr and exits 0', async () => {
	const { stdout, stderr, code } = await runCli({ args: ['help'] });

	expect(stdout).toBe('');
	expect(stderr).toBe(usageStderr);
	expect(code).toBe(0);
});

test('cli: an unknown command prints usage to stderr and exits 1', async () => {
	const { stdout, stderr, code } = await runCli({ args: ['nonsense'] });

	expect(stdout).toBe('');
	expect(stderr).toBe(usageStderr);
	expect(code).toBe(1);
});

test('cli: verify (removed command) prints usage to stderr and exits 1', async () => {
	const cwd = await freshCwd();

	const { stdout, stderr, code } = await runCli({ args: ['verify', '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toBe(usageStderr);
	expect(code).toBe(1);
});

test('cli: implement without --plan prints usage to stderr and exits 1', async () => {
	const cwd = await freshCwd();

	const { stdout, stderr, code } = await runCli({ args: ['implement', '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toBe(usageStderr);
	expect(code).toBe(1);
});

test('cli: resume without --run prints usage to stderr and exits 1', async () => {
	const cwd = await freshCwd();

	const { stdout, stderr, code } = await runCli({ args: ['resume', '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toBe(usageStderr);
	expect(code).toBe(1);
});

test('cli: plan explore (removed subcommand) prints usage to stderr and exits 1', async () => {
	const cwd = await freshCwd();

	const { stdout, stderr, code } = await runCli({ args: ['plan', 'explore', '--name', 'demo', '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toBe(usageStderr);
	expect(code).toBe(1);
});

test('cli: plan verify-facts without --name prints usage to stderr and exits 1', async () => {
	const cwd = await freshCwd();

	const { stdout, stderr, code } = await runCli({ args: ['plan', 'verify-facts', '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toBe(usageStderr);
	expect(code).toBe(1);
});

test('cli: plan lint without --name prints usage to stderr and exits 1', async () => {
	const cwd = await freshCwd();

	const { stdout, stderr, code } = await runCli({ args: ['plan', 'lint', '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toBe(usageStderr);
	expect(code).toBe(1);
});
