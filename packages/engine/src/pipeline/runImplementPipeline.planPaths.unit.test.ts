import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { loadConfig } from '#src/common/utils/loadConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

/**
 * A consumer repo with a plan and an overview on disk, driven by a stub that
 * implements one file and drops one stub test — enough for a run to go green.
 * `briefs` keeps the system prompt the implementer was handed — the role's
 * brief, which is where the plan and overview text end up.
 */
const setupPlanRun = async () => {
	const dir = setupConsumerRepo({ plan: '# Plan\n\nPLAN-SENTINEL\n' });
	const briefs: string[] = [];

	writeFileSync(join(dir, 'overview.md'), '# Overview\n\nOVERVIEW-SENTINEL\n');

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt, systemPrompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, 'test/feature.test.js'), '// stub test\n');

				return { text: report({ changedFiles: [{ path: 'test/feature.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'implement') {
				briefs.push(systemPrompt ?? '');
			}

			writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });

			return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};

	return { dir, driver, briefs, config: await loadConfig({ cwd: dir }) };
};

test('an absolute --plan is read from where it points and recorded relative to the repo', async () => {
	const { dir, driver, briefs, config } = await setupPlanRun();

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: join(dir, 'plan.md'), skipRefactor: true });

	// the run found its plan — the implementer was handed its text
	expect(result.ok).toBe(true);
	expect(briefs[0]).toContain('PLAN-SENTINEL');
	// and the record is the repo-relative form every reader and the resume path expect
	expect(result.manifest.plan).toBe('plan.md');
});

test('an absolute --overview is read and recorded the same way', async () => {
	const { dir, driver, briefs, config } = await setupPlanRun();

	const result = await runImplementPipeline({
		cwd: dir,
		driver,
		config,
		planPath: 'plan.md',
		overviewPath: join(dir, 'overview.md'),
		skipRefactor: true,
	});

	expect(result.ok).toBe(true);
	expect(briefs[0]).toContain('OVERVIEW-SENTINEL');
	expect(result.manifest.overview).toBe('overview.md');
});

test('a relative --plan is recorded exactly as named — the form it always had', async () => {
	const { dir, driver, config } = await setupPlanRun();

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

	expect(result.ok).toBe(true);
	expect(result.manifest.plan).toBe('plan.md');
});
