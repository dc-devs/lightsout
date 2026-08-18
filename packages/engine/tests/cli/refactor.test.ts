import { expect, test } from '@jest/globals';
import { runCli } from '@tests/helpers/runCli';
import { seedConfiguredCwd } from '@tests/helpers/seedConfiguredCwd';

test('cli: refactor rejects a --max-batches below one and exits 1', async () => {
	const cwd = await seedConfiguredCwd();

	const { stdout, stderr, code } = await runCli({ args: ['refactor', '--max-batches', '0', '--cwd', cwd] });

	expect(stdout).toBe('');
	// the flag name and the rejected value are the contract; the sentence carrying them is copy
	expect(stderr).toMatch(/--max-batches must be a positive integer/);
	expect(stderr).toContain("'0'");
	expect(code).toBe(1);
});

test('cli: refactor rejects a non-numeric --max-batches and exits 1', async () => {
	const cwd = await seedConfiguredCwd();

	const { stdout, stderr, code } = await runCli({ args: ['refactor', '--max-batches', 'lots', '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toMatch(/--max-batches must be a positive integer/);
	expect(stderr).toContain("'lots'");
	expect(code).toBe(1);
});

test('cli: refactor reports an unknown --run and exits 1 before starting anything', async () => {
	const cwd = await seedConfiguredCwd();

	const { stdout, stderr, code } = await runCli({ args: ['refactor', '--run', 'ghost', '--cwd', cwd] });

	// the refusal lands before the "resuming run" line is printed
	expect(stdout).toBe('');
	expect(stderr).toMatch(/no run matching 'ghost'/);
	expect(code).toBe(1);
});
