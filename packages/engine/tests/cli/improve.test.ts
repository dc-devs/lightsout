import { expect, test } from '@jest/globals';
import { freshCwd } from '@tests/helpers/freshCwd';
import { runCli } from '@tests/helpers/runCli';
import { seedConfiguredCwd } from '@tests/helpers/seedConfiguredCwd';

// improve resolves its driver through the per-command config BEFORE the
// friction check, and its config load is non-fatal — both paths exit at the
// empty-friction early return, so no harness binary is ever spawned.
test('cli: improve with no config and no friction reports nothing to improve and exits 0', async () => {
	const cwd = await freshCwd();

	const { stdout, stderr, code } = await runCli({ args: ['improve', '--engine', cwd, '--cwd', cwd] });

	expect(stdout).toBe('no friction recorded — nothing to improve from\n');
	expect(stderr).toBe('');
	expect(code).toBe(0);
});

test('cli: improve resolves a commands.improve driver override from the config and exits 0', async () => {
	const cwd = await seedConfiguredCwd({ config: { commands: { improve: { harness: 'codex' } } } });

	const { stdout, stderr, code } = await runCli({ args: ['improve', '--engine', cwd, '--cwd', cwd] });

	expect(stdout).toBe('no friction recorded — nothing to improve from\n');
	expect(stderr).toBe('');
	expect(code).toBe(0);
});
