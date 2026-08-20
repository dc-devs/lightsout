import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { runCli } from '#tests/helpers/runCli.ts';

// A consumer repo with a plan deliverable and deliberately NO
// lightsout.config.json: `plan lint` is deterministic and must route before
// resolveConfigAndDriver, so it works where a config-dependent command would
// fail. The plan lives in its own folder, derived from cwd and name alone, and
// the shared cleanPlanBody's paths resolve against what this seeds.
const seedPlanLintFixture = async ({ body }: { body: string }) => {
	const cwd = await freshCwd();
	const planDir = join(cwd, '.lightsout', 'plans', 'demo');

	await mkdir(join(cwd, 'src'), { recursive: true });
	await mkdir(planDir, { recursive: true });
	await writeFile(join(cwd, 'src', 'index.js'), 'export const one = 1;\n', 'utf8');
	await writeFile(join(planDir, 'plan.md'), body, 'utf8');

	return { cwd };
};

test('cli: plan lint on a clean plan reports clean and exits 0', async () => {
	const { cwd } = await seedPlanLintFixture({ body: cleanPlanBody() });

	const { stdout, stderr, code } = await runCli({ args: ['plan', 'lint', '--name', 'demo', '--cwd', cwd] });

	expect(stderr).toBe('');
	expect(stdout).toMatch(/plan lint demo: 0 structural finding\(s\) across 1 file\(s\)/);
	expect(stdout).toMatch(/plan lint demo — clean \(1 file\(s\)\)/);
	// a clean plan prints no finding lines
	expect(stdout.includes('⚠')).toBeFalsy();
	expect(code).toBe(0);
});

test('cli: plan lint on a plan with a placeholder prints the finding and exits 1', async () => {
	const { cwd } = await seedPlanLintFixture({ body: cleanPlanBody().replace('A new module exporting', 'TBD — a new module exporting') });

	const { stdout, stderr, code } = await runCli({ args: ['plan', 'lint', '--name', 'demo', '--cwd', cwd] });

	expect(stderr).toBe('');
	expect(stdout).toMatch(/plan lint demo — 1 structural finding\(s\) \(1 file\(s\)\)/);
	expect(stdout).toMatch(/⚠ \[no-placeholders\] plan\.md:\d+ — unresolved placeholder 'TBD' present/);
	expect(stdout).toMatch(/fix: resolve 'TBD'/);
	expect(code).toBe(1);
});

test('cli: plan lint without a plan deliverable reports the error and exits 1', async () => {
	const cwd = await freshCwd();

	const { stdout, stderr, code } = await runCli({ args: ['plan', 'lint', '--name', 'ghost', '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toMatch(/no plan found for 'ghost'/);
	expect(code).toBe(1);
});
