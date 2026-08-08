import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import type { Driver } from '@/drivers';
import { loadConfig } from '@/common/utils/loadConfig';
import { runImplementPipeline } from '@/pipeline';
import { report } from '@tests/helpers/report';
import { roleOf } from '@tests/helpers/roleOf';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

/**
 * A consumer repo whose implement step lands `source` at `src/subject.js` —
 * plus any `extraSources`, keyed by repo-relative path — and whose writers drop
 * one stub test, leaving the refactor role — answered by `onRefactor`, once per
 * pass — as the only thing left to decide the run. `onProgress` collects the
 * run's narration into `progress` for the tests that assert on what a watching
 * human is told.
 */
const setupRefactorRun = async ({
	source,
	extraSources = {},
	onRefactor,
}: {
	source: string;
	extraSources?: Record<string, string>;
	onRefactor: (params: { pass: number; cwd: string }) => string;
}) => {
	const dir = setupConsumerRepo();
	const progress: string[] = [];
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

			for (const [path, contents] of Object.entries(extraSources)) {
				mkdirSync(dirname(join(dir, path)), { recursive: true });
				writeFileSync(join(dir, path), contents);
			}

			return {
				text: report({
					changedFiles: [
						{ path: 'src/subject.js', summary: 'feature' },
						...Object.keys(extraSources).map((path) => ({ path, summary: 'feature' })),
					],
				}),
				exitCode: 0,
			};
		},
	};

	return {
		dir,
		driver,
		config: await loadConfig({ cwd: dir }),
		passesRun: () => passes,
		progress,
		onProgress: (message: string) => progress.push(message),
	};
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

test('refactor: a loop that spends every pass still changing files cannot walk past the standards gate', async () => {
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
	// the post-loop check escalates on the findings that survived
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
		// changes, so the site keys the checks report are identical each pass.
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

test('refactor: a first decline narrates how many findings the checks still report before buying another pass', async () => {
	const { dir, driver, config, progress, onProgress } = await setupRefactorRun({
		source: 'export const first = () => 1;\nexport const second = () => 2;\n',
		// A no-change pass whose work-list is the first one seen — the loop has
		// nothing to compare it against yet, so it narrates and spends another pass.
		onRefactor: () => report({ changedFiles: [] }),
	});

	await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', onProgress });

	expect(progress.some((line) => /^refactor pass 1: no changes but the checks still report [1-9]\d* finding\(s\) — another pass$/.test(line))).toBe(true);
});

test('refactor: a star re-export blocks the loop on its own — severity is the whole gate, with no allow-list of blockable rules', async () => {
	const { dir, driver, config } = await setupRefactorRun({
		// The subject file is deliberately clean (one export, named for its
		// file), so the only work-list finding in the tree is the `export *` in
		// the planted barrel — a rule no allow-list of site-key prefixes let
		// through before, and which the gate must now block on unaided.
		source: 'export const subject = () => 1;\n',
		extraSources: {
			'src/widget/widget.ts': 'export const widget = () => 1;\n',
			'src/widget/index.ts': "export * from './widget';\n",
		},
		onRefactor: () => report({ changedFiles: [] }),
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	expect(result.ok).toBe(false);
	expect(result.manifest.status).toBe('escalated');
	expect(result.error ?? '').toMatch(/barrel-star:src\/widget\/index\.ts/);
	expect(result.error ?? '').toMatch(/at src\/widget\/index\.ts/);
	// it carried the escalation alone — no other finding was blocking
	expect(result.error ?? '').toMatch(/1 finding\(s\) persist/);
});

test('refactor: the gate narration counts the work-list and the advisories, and nothing else', async () => {
	const { dir, driver, config, progress, onProgress } = await setupRefactorRun({
		// Two exports in one file: one blocking multi-export finding, plus the
		// unconsumed-export advisory that rides along with it — an advisory from
		// a rule outside the size family, which now reaches the loop too.
		source: 'export const first = () => 1;\nexport const second = () => 2;\n',
		onRefactor: () => report({ changedFiles: [] }),
	});

	await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', onProgress });

	// anchored at both ends: the work-list count IS the blocking count, so the
	// line carries no separate blocking tally
	expect(progress.some((line) => /^standards gate: [1-9]\d* finding\(s\) \+ [1-9]\d* advisory\(ies\) on changed files$/.test(line))).toBe(true);
});

test('refactor: a loop that spends every pass on a tree the checks find clean passes at the post-loop check', async () => {
	const { dir, driver, config, passesRun } = await setupRefactorRun({
		source: 'export const subject = () => 1;\n',
		onRefactor: ({ pass, cwd }) => {
			// Every pass edits the file and reports the change, so the loop never
			// takes its no-change exit — but nothing it writes is a work-list
			// finding, so the post-loop check has nothing to escalate on.
			writeFileSync(join(cwd, 'src/subject.js'), `export const subject = () => ${pass};\n`);

			return report({ changedFiles: [{ path: 'src/subject.js', summary: `pass ${pass}` }] });
		},
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	expect(result.ok).toBe(true);
	expect(result.manifest.steps.find((step) => step.id === 'refactor')?.status).toBe('passed');
	// the full pass budget was spent, and the post-loop check let the run through
	expect(passesRun()).toBe(3);
});
