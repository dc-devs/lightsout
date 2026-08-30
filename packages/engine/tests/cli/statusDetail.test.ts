import { expect, test } from '@jest/globals';
import { runCli } from '#tests/helpers/runCli.ts';
import { seedRunFixture } from '#tests/helpers/seedRunFixture.ts';

test('cli: status --run prints the block for that run and exits 0', async () => {
	const { cwd, runId } = await seedRunFixture({ status: 'failed' });

	const { stdout, stderr, code } = await runCli({ args: ['status', '--run', runId, '--cwd', cwd] });

	// a frame is appended, never a screen cleared — the blank line opens it
	expect(stdout.startsWith('\n')).toBe(true);
	expect(stdout).toContain('run-fixt');
	expect(stdout).toMatch(/ elapsed \d+m \d\ds · 0 files/);
	expect(stderr).toBe('');
	expect(code).toBe(0);
});

test('cli: status --run naming no run exits 1 and says the id was wrong', async () => {
	const { cwd } = await seedRunFixture({ status: 'failed' });

	const { stdout, stderr, code } = await runCli({ args: ['status', '--run', 'ghost', '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toBe(`no run matching 'ghost' — list the runs this repo has with: lightsout status\n`);
	expect(code).toBe(1);
});
