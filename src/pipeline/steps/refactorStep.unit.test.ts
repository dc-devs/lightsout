import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Driver } from '@/drivers';
import { loadConfig } from '@/common/utils/loadConfig';
import { runImplementPipeline } from '@/pipeline';
import { report } from '@tests/helpers/report';
import { roleOf } from '@tests/helpers/roleOf';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

/**
 * A consumer repo whose implement step lands `source` at `src/subject.js` and
 * whose writers drop one stub test, leaving the refactor role — answered by
 * `onRefactor`, once per pass — as the only thing left to decide the run.
 */
const setupRefactorRun = async ({ source, onRefactor }: { source: string; onRefactor: (params: { pass: number; cwd: string }) => string }) => {
	const dir = setupConsumerRepo();
	let passes = 0;
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'write-tests') {
				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, 'test/subject.test.js'), '// stub test\n');

				return { text: report({ changedFiles: [{ path: 'test/subject.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				passes += 1;

				return { text: onRefactor({ pass: passes, cwd: dir }), exitCode: 0 };
			}

			writeFileSync(join(dir, 'src/subject.js'), source);

			return { text: report({ changedFiles: [{ path: 'src/subject.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};

	return { dir, driver, config: await loadConfig({ cwd: dir }), passesRun: () => passes };
};

test('refactor: a failed report stops the run as failed, carrying the failure text the agent reported', async () => {
	const { dir, driver, config, passesRun } = await setupRefactorRun({
		source: 'export const feature = () => 2;\n',
		onRefactor: () => report({ status: 'failed', failures: ['REFACTOR-FAILURE-SENTINEL'] }),
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	assert.equal(result.ok, false);
	assert.equal(result.manifest.status, 'failed');
	assert.match(result.error ?? '', /refactor: failed — REFACTOR-FAILURE-SENTINEL/);
	assert.equal(passesRun(), 1, 'a failed report ends the loop on the spot');
	assert.equal(result.manifest.steps.find((step) => step.id === 'refactor')?.status, 'failed');
	assert.equal(result.manifest.steps.find((step) => step.id === 'verify-refactor'), undefined, 'the run never reached the refactor verify');
});

test('refactor: a terminated report escalates rather than failing — it needs a human, not a retry', async () => {
	const { dir, driver, config, passesRun } = await setupRefactorRun({
		source: 'export const feature = () => 2;\n',
		onRefactor: () => report({ status: 'terminated:scope', failures: ['REFACTOR-SCOPE-SENTINEL'] }),
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	assert.equal(result.ok, false);
	assert.equal(result.manifest.status, 'escalated');
	assert.match(result.error ?? '', /refactor: terminated:scope — REFACTOR-SCOPE-SENTINEL/);
	assert.equal(passesRun(), 1, 'a terminated report ends the loop on the spot');
	assert.equal(result.manifest.steps.find((step) => step.id === 'refactor')?.status, 'escalated');
});

test('refactor: a loop that spends every pass still changing files cannot walk past the scan gate', async () => {
	const { dir, driver, config, passesRun } = await setupRefactorRun({
		source: 'export const first = () => 1;\nexport const second = () => 2;\n',
		onRefactor: ({ pass, cwd }) => {
			// Every pass edits the file and reports the change, so the loop never
			// takes its no-change exit — it simply runs out of passes.
			writeFileSync(join(cwd, 'src/subject.js'), `export const first = () => ${pass};\nexport const second = () => 2;\n`);

			return report({ changedFiles: [{ path: 'src/subject.js', summary: `pass ${pass}` }] });
		},
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	assert.equal(result.ok, false);
	assert.equal(result.manifest.status, 'escalated');
	assert.equal(passesRun(), 3, 'a pass that changes files always earns the next one — the budget is spent in full');
	assert.match(result.error ?? '', /persist after 3 pass\(es\)/, 'the post-loop scan escalates on the findings that survived');
	assert.match(result.error ?? '', /multi-export:src\/subject\.js/, 'the surviving cluster is named');
	assert.match(result.error ?? '', /at src\/subject\.js/, 'with the site a human has to open');
	assert.doesNotMatch(result.error ?? '', /account of its final pass/, 'an agent that reported no friction contributes no rationale block');
});
