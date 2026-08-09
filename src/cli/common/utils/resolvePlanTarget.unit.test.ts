import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { resolvePlanTarget } from '@/cli/common/utils/resolvePlanTarget';

/** A temp repo holding a plan file plus a `plans/demo` folder seeded with whatever the case needs. */
const setupPlanFolder = ({ files }: { files: string[] }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-target-'));
	const folder = join('plans', 'demo');

	mkdirSync(join(cwd, folder), { recursive: true });
	writeFileSync(join(cwd, 'single.md'), '# Plan\n');

	for (const file of files) {
		writeFileSync(join(cwd, folder, file), '# Plan\n');
	}

	return { cwd, folder };
};

test('resolvePlanTarget: a plan file passes through exactly as the user typed it', async () => {
	const { cwd } = setupPlanFolder({ files: [] });

	expect(await resolvePlanTarget({ cwd, planPath: 'single.md' })).toStrictEqual({ planPath: 'single.md' });
});

test('resolvePlanTarget: a path that does not exist passes through — the pipeline owns the missing-file error', async () => {
	const { cwd } = setupPlanFolder({ files: [] });

	expect(await resolvePlanTarget({ cwd, planPath: 'ghost.md' })).toStrictEqual({ planPath: 'ghost.md' });
});

test('resolvePlanTarget: a folder holding an overview resolves to it even when a plan.md sits beside it', async () => {
	const { cwd, folder } = setupPlanFolder({ files: ['overview.md', 'plan.md'] });

	expect(await resolvePlanTarget({ cwd, planPath: folder })).toStrictEqual({ overviewPath: join(folder, 'overview.md') });
});

test('resolvePlanTarget: a folder holding only a plan.md resolves to that single plan', async () => {
	const { cwd, folder } = setupPlanFolder({ files: ['plan.md'] });

	expect(await resolvePlanTarget({ cwd, planPath: folder })).toStrictEqual({ planPath: join(folder, 'plan.md') });
});

test('resolvePlanTarget: a folder holding neither names both files it looked for', async () => {
	const { cwd, folder } = setupPlanFolder({ files: ['notes.md'] });

	expect(await resolvePlanTarget({ cwd, planPath: folder })).toStrictEqual({ error: `plan folder holds neither overview.md nor plan.md: ${folder}` });
});
