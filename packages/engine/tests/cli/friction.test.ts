import { expect, test } from '@jest/globals';
import { freshCwd } from '@tests/helpers/freshCwd';
import { runCli } from '@tests/helpers/runCli';

test('cli: friction in a fresh dir reports nothing recorded and exits 0', async () => {
	const cwd = await freshCwd();

	const { stdout, stderr, code } = await runCli({ args: ['friction', '--cwd', cwd] });

	expect(stdout).toBe('no friction recorded\n');
	expect(stderr).toBe('');
	expect(code).toBe(0);
});
