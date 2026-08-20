import { expect, test } from '@jest/globals';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { runCli } from '#tests/helpers/runCli.ts';

// The dispatch table's doctor entry, end to end: a dir with no config is the
// one doctor outcome that needs no harness binary installed, so the route is
// observable without depending on the machine running the suite.
test('cli: doctor in a fresh dir fails on the missing config and exits 1', async () => {
	const cwd = await freshCwd();

	const { stdout, stderr, code } = await runCli({ args: ['doctor', '--cwd', cwd] });

	expect(stdout).toMatch(/^doctor {4}/);
	expect(stdout).toMatch(/✗ config/);
	expect(stdout).toMatch(/\n1 check\(s\) · 1 fail\n$/);
	expect(stderr).toBe('');
	expect(code).toBe(1);
});
