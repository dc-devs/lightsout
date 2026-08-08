import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
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

	expect(result.ok).toBe(false);
	expect(result.manifest.status).toBe('failed');
	expect(result.error ?? '').toMatch(/refactor: failed — REFACTOR-FAILURE-SENTINEL/);
	// a failed report ends the loop on the spot
	expect(passesRun()).toBe(1);
	expect(result.manifest.steps.find((step) => step.id === 'refactor')?.status).toBe('failed');
	// the run never reached the refactor verify
	expect(result.manifest.steps.find((step) => step.id === 'verify-refactor')).toBe(undefined);
});

test('refactor: a terminated report escalates rather than failing — it needs a human, not a retry', async () => {
	const { dir, driver, config, passesRun } = await setupRefactorRun({
		source: 'export const feature = () => 2;\n',
		onRefactor: () => report({ status: 'terminated:scope', failures: ['REFACTOR-SCOPE-SENTINEL'] }),
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	expect(result.ok).toBe(false);
	expect(result.manifest.status).toBe('escalated');
	expect(result.error ?? '').toMatch(/refactor: terminated:scope — REFACTOR-SCOPE-SENTINEL/);
	// a terminated report ends the loop on the spot
	expect(passesRun()).toBe(1);
	expect(result.manifest.steps.find((step) => step.id === 'refactor')?.status).toBe('escalated');
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

	expect(result.ok).toBe(false);
	expect(result.manifest.status).toBe('escalated');
	// a pass that changes files always earns the next one — the budget is spent in
	// full
	expect(passesRun()).toBe(3);
	// the post-loop scan escalates on the findings that survived
	expect(result.error ?? '').toMatch(/persist after 3 pass\(es\)/);
	// the surviving cluster is named
	expect(result.error ?? '').toMatch(/multi-export:src\/subject\.js/);
	// with the site a human has to open
	expect(result.error ?? '').toMatch(/at src\/subject\.js/);
	// an agent that reported no friction contributes no rationale block
	expect(result.error ?? '').not.toMatch(/account of its final pass/);
});

test('refactor: a pass declining the identical gating set escalates early rather than re-buying the same answer', async () => {
	const { dir, driver, config, passesRun } = await setupRefactorRun({
		source: 'export const first = () => 1;\nexport const second = () => 2;\n',
		// Every pass judges the findings not worth acting on and reports no
		// changes, so the site keys the scanner reports are identical each pass.
		onRefactor: () => report({ changedFiles: [] }),
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	expect(result.ok).toBe(false);
	expect(result.manifest.status).toBe('escalated');
	// the disagreement is stable by the second pass — the third is never spent
	expect(passesRun()).toBe(2);
	expect(result.error ?? '').toMatch(/persist after 2 pass\(es\)/);
	// the site key that came back unchanged across both passes is named
	expect(result.error ?? '').toMatch(/multi-export:src\/subject\.js/);
	expect(result.error ?? '').toMatch(/at src\/subject\.js/);
});

test("refactor: the escalation carries the agent's reported friction as its account of the final pass", async () => {
	const { dir, driver, config } = await setupRefactorRun({
		source: 'export const first = () => 1;\nexport const second = () => 2;\n',
		onRefactor: () =>
			report({
				changedFiles: [],
				friction: [{ kind: 'decision', area: 'plan', detail: 'SPLIT-WOULD-BREAK-THE-BARREL' }],
			}),
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	// the human reading the escalation gets the agent's reasoning, not just the sites
	expect(result.error ?? '').toMatch(/account of its final pass/);
	expect(result.error ?? '').toMatch(/- \[plan\] SPLIT-WOULD-BREAK-THE-BARREL/);
	// and the persisting site key still leads the message
	expect(result.error ?? '').toMatch(/multi-export:src\/subject\.js/);
});
