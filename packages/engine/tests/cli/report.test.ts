import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { runCli } from '#tests/helpers/runCli.ts';
import { usageStderr } from '#tests/helpers/usageStderr.ts';

// The dispatch table's report entry, end to end. A plan folder written before
// the activity record existed holds none, which is the one report outcome
// observable without a planning run to spend money on.
const seedPlanFolderWithoutRecord = async () => {
	const cwd = await freshCwd();
	const planDir = join(cwd, '.lightsout', 'tickets', 'demo', 'plans');

	await mkdir(planDir, { recursive: true });
	await writeFile(join(planDir, 'plan.md'), '# Demo\n', 'utf8');

	return { cwd };
};

test('cli: report on a plan with no activity record says so and exits 0', async () => {
	const { cwd } = await seedPlanFolderWithoutRecord();

	const { stdout, stderr, code } = await runCli({ args: ['report', '--plan', 'demo', '--cwd', cwd] });

	expect(stdout).toMatch(/no activity record/);
	// the folder is named, and no empty box-drawn table is printed in place of one
	expect(stdout).toMatch(/demo/);
	expect(stdout.includes('┌')).toBeFalsy();
	expect(stderr).toBe('');
	expect(code).toBe(0);
});

test('cli: report with no --plan prints the usage text and exits 1', async () => {
	const cwd = await freshCwd();

	const { stdout, stderr, code } = await runCli({ args: ['report', '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toBe(usageStderr);
	expect(code).toBe(1);
});
