import { expect, test } from '@jest/globals';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { runCli } from '#tests/helpers/runCli.ts';
import { seedConfiguredCwd } from '#tests/helpers/seedConfiguredCwd.ts';
import { usageStderr } from '#tests/helpers/usageStderr.ts';

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

test('cli: work-order is dispatched, the removed ticket command prints usage and exits 1, and ticket-state still resolves', async () => {
	const cwd = await seedConfiguredCwd();

	const workOrder = await runCli({ args: ['work-order', 'show', '--name', 'demo', '--cwd', cwd] });
	const ticket = await runCli({ args: ['ticket', 'show', '--name', 'demo', '--cwd', cwd] });
	const ticketState = await runCli({ args: ['ticket-state', '--ref', 'LO-158', '--cwd', cwd] });

	expect(workOrder.stderr).not.toBe(usageStderr);
	expect(workOrder.stderr).toContain('lightsout work-order add-plan');
	expect(ticket).toEqual(expect.objectContaining({ stdout: '', stderr: usageStderr, code: 1 }));
	expect(ticketState.stderr).not.toBe(usageStderr);
	expect(ticketState.stderr).toContain('--planning-status');
});

// `--from` was removed from the work-order catalog entry when a work order's
// folder name became a label rather than an identity. The flag set is checked
// against the command word in main, before `work-order` is entered, so the
// message names `work-order` rather than `work-order add-plan`, and the add
// never reaches a config or a record.
test('cli: work-order add-plan --from (removed flag) prints usage to stderr and exits 1', async () => {
	const cwd = await freshCwd();

	const { stdout, stderr, code } = await runCli({
		args: ['work-order', 'add-plan', '--name', 'demo', '--slug', 'first-plan', '--from', 'loose-folder', '--cwd', cwd],
	});

	expect(stdout).toBe('');
	expect(stderr).toBe(`lightsout work-order: unknown flag --from\n\n${usageStderr}`);
	expect(code).toBe(1);
});
