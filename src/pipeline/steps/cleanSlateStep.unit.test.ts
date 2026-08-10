import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { report } from '@tests/helpers/report';
import { reviewReport } from '@tests/helpers/reviewReport';
import { roleOf } from '@tests/helpers/roleOf';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { loadConfig } from '@/common/utils/loadConfig';
import type { Driver } from '@/drivers';
import { runImplementPipeline } from '@/pipeline';

/**
 * A consumer repo whose gates behave as `scripts` says, driven by a stub that
 * implements one source file and drops one stub test per writer. `spawned`
 * records agent roles — clean-slate's contract is that a red baseline buys
 * none of them.
 */
const setupCleanSlateRun = async ({ scripts }: { scripts: Record<string, string | false> }) => {
	const dir = setupConsumerRepo({ scripts });
	const spawned: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			spawned.push(role);

			if (role === 'write-tests') {
				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, 'test/feature.test.js'), '// stub test\n');

				return { text: report({ changedFiles: [{ path: 'test/feature.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			writeFileSync(join(dir, 'src/feature.js'), 'export const feature = () => 2;\n');

			return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};

	return { dir, driver, spawned, config: await loadConfig({ cwd: dir }) };
};

test('clean-slate: a red baseline gate fails the run before a single agent is spawned', async () => {
	const { dir, driver, spawned, config } = await setupCleanSlateRun({ scripts: { check: 'echo BASELINE-SENTINEL >&2; exit 1' } });

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	expect(result.ok).toBe(false);
	expect(result.manifest.status).toBe('failed');
	expect(result.error ?? '').toMatch(/Codebase is not green before implementation — fix this first\./);
	// the gate output travels with the verdict
	expect(result.error ?? '').toMatch(/BASELINE-SENTINEL/);
	expect(result.manifest.steps.find((step) => step.id === 'clean-slate')?.status).toBe('failed');
	// the run never reached implement
	expect(result.manifest.steps.find((step) => step.id === 'implement')).toBe(undefined);
	// a red baseline costs no agent turn to learn
	expect(spawned).toStrictEqual([]);
});

test('clean-slate: artifacts left behind by a gate command fold into the baseline, never the changed files', async () => {
	const { dir, driver, config } = await setupCleanSlateRun({
		scripts: { check: `node -e "require('fs').appendFileSync('gate-artifact.log','x')"` },
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

	expect(result.ok).toBe(true);
	// the artifact folded into the baseline at clean-slate
	expect(result.manifest.baselineDirtyFiles.includes('gate-artifact.log')).toBeTruthy();
	// and is never attributed to the agents
	expect(result.manifest.changedFiles.includes('gate-artifact.log')).toBeFalsy();
	// real agent work is still attributed
	expect(result.manifest.changedFiles.includes('src/feature.js')).toBeTruthy();
	expect(result.manifest.steps.find((step) => step.id === 'clean-slate')?.status).toBe('passed');
});
