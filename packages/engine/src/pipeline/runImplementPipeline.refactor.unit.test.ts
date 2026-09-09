import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { cleanupRecordOf } from '#tests/helpers/cleanupRecordOf.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { withTestChangeReview } from '#tests/helpers/withTestChangeReview.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

/** The rule ids the standards reviewer was handed, in the order its invocation lists them. */
const ruleIdsOffered = ({ systemPrompt }: { systemPrompt: string }) => [...systemPrompt.matchAll(/Rule id: `([^`]+)`/g)].map(([, id]) => id ?? '');

/** The repo-relative files the standards reviewer was asked to read, one per list line of its prompt. */
const filesOffered = ({ prompt }: { prompt: string }) => [...prompt.matchAll(/^- (.+)$/gm)].map(([, path]) => path ?? '');

/**
 * A consumer repo whose implement step lands `source` at `src/subject.js` —
 * plus any `extraSources`, keyed by repo-relative path — and whose writers drop
 * one stub test, leaving the refactor role — answered by `onRefactor`, once per
 * pass — as the only thing left to decide the run. `onReview` answers the
 * standards reviewer that runs beside the machine checks, defaulting to the
 * empty report every test that is not about the review wants. `onProgress`
 * collects the run's narration into `progress` for the tests that assert on
 * what a watching human is told.
 */
const setupRefactorRun = async ({
	source,
	extraSources = {},
	onReview = () => reviewReport(),
	onRefactor,
	parkRound,
	config: repoConfig,
}: {
	source: string;
	extraSources?: Record<string, string>;
	onReview?: (params: { ruleIds: string[] }) => string;
	onRefactor: (params: { pass: number; cwd: string }) => string;
	/** The cleanup round the harness answers with a rate limit instead of a report. */
	parkRound?: number;
	/** Extra repo config — for a fixture whose subject is a shape some rule objects to. */
	config?: Record<string, unknown>;
}) => {
	const dir = setupConsumerRepo({ config: repoConfig });
	const progress: string[] = [];
	const refactorPrompts: string[] = [];
	const reviewScopes: string[][] = [];
	let passes = 0;
	const driver: Driver = {
		name: 'stub',
		invoke: withTestChangeReview({
			invoke: async ({ prompt, systemPrompt }) => {
				const role = roleOf(prompt);

				// The reviewer's system prompt rides its own invocation AND the re-emit
				// retry a rejected report earns, so answering on it keeps a reviewer that
				// cannot report from being mistaken for another role on the second try.
				if ((systemPrompt ?? '').includes('# Role: Standards Reviewer')) {
					if (role === 'standards-review') {
						reviewScopes.push(filesOffered({ prompt }));
					}

					return { text: onReview({ ruleIds: ruleIdsOffered({ systemPrompt: systemPrompt ?? '' }) }), exitCode: 0 };
				}

				if (role === 'write-tests') {
					mkdirSync(join(dir, 'test'), { recursive: true });
					writeFileSync(join(dir, 'test/subject.test.js'), '// stub test\n');

					return { text: report({ changedFiles: [{ path: 'test/subject.test.js', summary: 'tests' }] }), exitCode: 0 };
				}

				if (role === 'refactor') {
					passes += 1;
					refactorPrompts.push(prompt);

					return passes === parkRound ? { text: '', exitCode: 1, rateLimited: true } : { text: onRefactor({ pass: passes, cwd: dir }), exitCode: 0 };
				}

				writeSource({ dir, path: 'src/subject.js', source });

				for (const [path, contents] of Object.entries(extraSources)) {
					mkdirSync(dirname(join(dir, path)), { recursive: true });
					writeFileSync(join(dir, path), contents);
				}

				return {
					text: report({
						changedFiles: [{ path: 'src/subject.js', summary: 'feature' }, ...Object.keys(extraSources).map((path) => ({ path, summary: 'feature' }))],
					}),
					exitCode: 0,
				};
			},
		}),
	};

	return {
		dir,
		driver,
		config: await readConfig({ cwd: dir }),
		passesRun: () => passes,
		progress,
		refactorPrompts,
		reviewScopes,
		onProgress: (message: string) => progress.push(message),
	};
};

test('refactor: a first decline narrates how much still qualifies before buying another round', async () => {
	const { dir, driver, config, progress, onProgress } = await setupRefactorRun({
		source: 'export const first = () => 1;\nexport const second = () => 2;\n',
		// A no-change round whose work list is the first one seen — the loop has
		// nothing to compare it against yet, so it narrates and spends another round.
		onRefactor: () => report({ changedFiles: [] }),
	});

	await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', onProgress });

	expect(progress.some((line) => /^refactor round 1: no changes but [1-9]\d* qualifying blocking finding\(s\) remain — another round$/.test(line))).toBe(true);
});

test('refactor: a star re-export is cleanup work on its own — severity is the whole lever, with no allow-list of blockable rules', async () => {
	const { dir, driver, config, refactorPrompts } = await setupRefactorRun({
		// The subject file is deliberately clean (one export, named for its
		// file), so the only work-list finding in the tree is the `export *` in
		// the planted barrel — a rule no allow-list of site-key prefixes let
		// through before, and which the gate must now block on unaided.
		source: 'export const subject = () => 1;\n',
		extraSources: {
			'src/widget/widget.ts': 'export const widget = () => 1;\n',
			'src/widget/index.ts': "export * from './widget';\n",
		},
		// the planted barrel is also, unavoidably, a barrel nothing consumes — a
		// second verdict on the same file that would make "alone" untestable
		config: { 'standards-checks': { 'barrel-is-only-consumer': 'off' } },
		onRefactor: () => report({ changedFiles: [] }),
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });
	const cleanup = cleanupRecordOf({ steps: result.manifest.steps });

	expectDefined(cleanup);
	// it earned the round alone — no other finding was blocking
	expect(refactorPrompts[0] ?? '').toMatch(/Blocking —[\s\S]*- \[barrel-star\] src\/widget\/index\.ts/);
	expect(cleanup.remaining.map((finding) => finding.siteKey)).toStrictEqual(['barrel-star:src/widget/index.ts']);
	// and left standing it is recorded, never a stop
	expect(result.manifest.steps.find((step) => step.id === 'refactor')?.status).toBe('passed');
	expect(result.ok).toBe(true);
});

test('refactor: the gate narration counts the work-list and the advisories, and nothing else', async () => {
	const { dir, driver, config, progress, onProgress } = await setupRefactorRun({
		// Two exports in one file: one blocking multi-export finding. The near-copy
		// beside it contributes a duplicate-block advisory — a rule outside the size family,
		// so the line has both counts to carry.
		source: 'export const first = () => 1;\nexport const second = () => 2;\n',
		extraSources: { 'src/copyOfFirst.js': `export const copyOfFirst = () => {\n${'\tconst padding = 1;\n'.repeat(40)}\treturn 1;\n};\n` },
		onRefactor: () => report({ changedFiles: [] }),
	});

	await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', onProgress });

	// anchored at both ends: the work-list count IS the blocking count, so the
	// line carries no separate blocking tally
	expect(progress.some((line) => /^standards gate: [1-9]\d* blocking \+ [1-9]\d* advisory on changed files$/.test(line))).toBe(true);
});

test("refactor: the agent review's findings join the advisory list the refactorer is handed", async () => {
	const { dir, driver, config, refactorPrompts } = await setupRefactorRun({
		// A clean file, so nothing the machine checks report can be mistaken for
		// the reviewer's finding.
		source: 'export const subject = () => 1;\n',
		onReview: ({ ruleIds }) =>
			reviewReport([
				{ rule: ruleIds[0], files: [{ path: 'src/subject.js', startLine: 1 }], detail: 'REVIEW-DETAIL-SENTINEL', guidance: 'REVIEW-GUIDANCE-SENTINEL' },
			]),
		onRefactor: () => report({ changedFiles: [] }),
	});

	await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	// under the advisory heading, sited and carrying both halves of its text —
	// judgment handed to a judge, never blocking work
	expect(refactorPrompts[0] ?? '').toMatch(/Advisory —[\s\S]*- \[[^\]]+\] src\/subject\.js:1 — REVIEW-DETAIL-SENTINEL — REVIEW-GUIDANCE-SENTINEL/);
});

test('refactor: a review finding cannot hold the run — the reviewer objects every pass and the gate still lets it through', async () => {
	const { dir, driver, config } = await setupRefactorRun({
		// The machine checks find nothing here, so the reviewer's objection is the
		// only finding in the run.
		source: 'export const subject = () => 1;\n',
		onReview: ({ ruleIds }) => reviewReport([{ rule: ruleIds[0], files: [{ path: 'src/subject.js' }], detail: 'this name reads oddly to me' }]),
		onRefactor: () => report({ changedFiles: [] }),
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	expect(result.ok).toBe(true);
	expect(result.manifest.steps.find((step) => step.id === 'refactor')?.status).toBe('passed');
});

test('refactor: a review that could not run is narrated and left behind — the machine checks still decide', async () => {
	const { dir, driver, config, progress, onProgress } = await setupRefactorRun({
		source: 'export const first = () => 1;\nexport const second = () => 2;\n',
		// A harness answering the reviewer with something that is not a report at
		// all: the review is skipped, never turned into a failed run.
		onReview: () => 'the harness fell over',
		onRefactor: () => report({ changedFiles: [] }),
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', onProgress });
	const cleanup = cleanupRecordOf({ steps: result.manifest.steps });

	expectDefined(cleanup);
	expect(progress.some((line) => line.startsWith('agent review skipped —'))).toBe(true);
	// the work list the machine checks reported is what cleanup spent its rounds on, and what it recorded
	expect(cleanup.remaining.map((finding) => finding.siteKey)).toContain('multi-export:src/subject.js');
	expect(result.ok).toBe(true);
});

test("refactor: the review reads the run's changed source — not the tests the run wrote, nor files it never touched", async () => {
	const { dir, driver, config, reviewScopes } = await setupRefactorRun({
		source: 'export const subject = () => 1;\n',
		extraSources: { 'src/widget.js': 'export const widget = () => 1;\n' },
		onRefactor: () => report({ changedFiles: [] }),
	});

	await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	// the repo's committed src/index.js and the writers' test/subject.test.js are
	// both absent — scope is this run's changed source and nothing else. Cleanup
	// changed nothing, so that one read is the only one bought.
	expect(reviewScopes).toStrictEqual([['src/subject.js', 'src/widget.js', 'src/useSubject.js']]);
});

test('refactor: a tree the checks find clean spends no cleanup round at all', async () => {
	const { dir, driver, config, passesRun } = await setupRefactorRun({
		source: 'export const subject = () => 1;\n',
		onRefactor: ({ pass, cwd }) => {
			// Never reached: nothing in this tree qualifies, and the reviewer reports
			// nothing either, so there is no work to hand an executor.
			writeSource({ dir: cwd, path: 'src/subject.js', source: `export const subject = () => ${pass};\n` });

			return report({ changedFiles: [{ path: 'src/subject.js', summary: `pass ${pass}` }] });
		},
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });
	const cleanup = cleanupRecordOf({ steps: result.manifest.steps });

	expectDefined(cleanup);
	expect(result.ok).toBe(true);
	expect(result.manifest.steps.find((step) => step.id === 'refactor')?.status).toBe('passed');
	// the budget is a maximum, not a quota — an empty work list buys nothing
	expect(passesRun()).toBe(0);
	expect(cleanup).toEqual(expect.objectContaining({ roundsUsed: 0, endReason: 'no-work' }));
});

test('refactor: the executor may write the test files its findings name, or it is handed work it cannot do', async () => {
	const { dir, driver, config, refactorPrompts } = await setupRefactorRun({
		source: 'export const subject = () => 1;\n',
		extraSources: { 'src/__tests__/helper.js': 'export const helper = () => 1;\n' },
		onRefactor: () => report({ changedFiles: [] }),
	});

	await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	// the scope section is the executor's write permission — a finding on a file
	// missing from it is a blocking demand the role prompt forbids acting on
	expect(refactorPrompts[0] ?? '').toContain('src/__tests__/helper.js');
});

/**
 * A refactor run whose one cleanup round rewrites `src/subject.js` down to a
 * single export — which rewrites the consumer beside it too, so the round
 * edits two files — while the report it hands back names only the subject.
 * `finalFindings` answers the judgment reviewer's SECOND read, the one over the
 * files cleanup changed; the first read reports nothing.
 */
const setupOmittedEditRun = async ({ finalFindings = () => reviewReport() }: { finalFindings?: (params: { ruleIds: string[] }) => string } = {}) => {
	let reviews = 0;

	return setupRefactorRun({
		source: 'export const first = () => 1;\nexport const second = () => 2;\n',
		onReview: ({ ruleIds }) => {
			reviews += 1;

			return reviews === 1 ? reviewReport() : finalFindings({ ruleIds });
		},
		onRefactor: ({ cwd }) => {
			writeSource({ dir: cwd, path: 'src/subject.js', source: 'export const first = () => 1;\n' });

			return report({ changedFiles: [{ path: 'src/subject.js', summary: 'dropped the second export' }] });
		},
	});
};

test('a file the cleanup report omitted is still found by content and reviewed', async () => {
	const { dir, driver, config, reviewScopes } = await setupOmittedEditRun();

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	// the consumer the round rewrote is on the step record even though the
	// report never named it — bytes, not claims, decide what cleanup changed
	expect(result.manifest.steps.find((step) => step.id === 'refactor')?.changedFiles).toEqual(expect.arrayContaining(['src/subject.js', 'src/useSubject.js']));
	// and the final review is handed both of them
	expect([...(reviewScopes.at(-1) ?? [])].sort()).toStrictEqual(['src/subject.js', 'src/useSubject.js']);
});

test('an introduced blocking finding on a test file the run wrote is worked and recorded, never a stop', async () => {
	const { dir, driver, config, refactorPrompts } = await setupRefactorRun({
		source: 'export const subject = () => 1;\n',
		// a test file by path that the run itself wrote, so the finding on it is
		// absent from the pre-edit baseline and qualifies as this run's own work
		extraSources: { 'src/__tests__/helper.js': 'export const helper = () => 1;\n' },
		onRefactor: () => report({ changedFiles: [] }),
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });
	const cleanup = cleanupRecordOf({ steps: result.manifest.steps });

	expectDefined(cleanup);
	// severity still directs the effort: it is handed over as blocking work
	expect(refactorPrompts[0] ?? '').toMatch(/Blocking —[\s\S]*- \[test-in-tests-folder\]/);
	// the executor left it, so it is recorded rather than escalated
	expect(cleanup.remaining.map((finding) => finding.rule)).toContain('test-in-tests-folder');
	expect(result.manifest.steps.find((step) => step.id === 'refactor')?.status).toBe('passed');
	expect(result.ok).toBe(true);
});

test('a rate-limited cleanup round parks the run with its round count recorded', async () => {
	const { dir, driver, config } = await setupRefactorRun({
		// a two-export file gives cleanup qualifying work to spend a round on, and
		// the harness answers that round with a rate limit rather than a report
		source: 'export const first = () => 1;\nexport const second = () => 2;\n',
		parkRound: 1,
		onRefactor: () => report({ changedFiles: [] }),
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });
	const cleanup = cleanupRecordOf({ steps: result.manifest.steps });

	expectDefined(cleanup);
	expect(result.manifest.status).toBe('paused-rate-limit');
	// the park bought no outcome, so the resume re-invokes that same round
	expect(cleanup.roundsUsed).toBe(0);
	// and a park is not an ending — nothing claims cleanup finished
	expect(cleanup.endReason).toBe(undefined);
});

test('the final review reads the files cleanup changed and buys no round', async () => {
	const { dir, driver, config, reviewScopes, passesRun } = await setupOmittedEditRun({
		finalFindings: ({ ruleIds }) => reviewReport([{ rule: ruleIds[0], files: [{ path: 'src/subject.js' }], detail: 'FINAL-REVIEW-SENTINEL' }]),
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });
	const cleanup = cleanupRecordOf({ steps: result.manifest.steps });

	expectDefined(cleanup);
	// exactly the files the round changed — not the whole run's changed source
	expect([...(reviewScopes.at(-1) ?? [])].sort()).toStrictEqual(['src/subject.js', 'src/useSubject.js']);
	expect(cleanup.finalReview.map((finding) => finding.detail)).toStrictEqual(['FINAL-REVIEW-SENTINEL']);
	// the reviewer objected and bought nothing — one round is all that was spent
	expect(passesRun()).toBe(1);
});

test('cleanup that changed nothing reuses its initial review as the final one', async () => {
	const { dir, driver, config, reviewScopes } = await setupRefactorRun({
		source: 'export const first = () => 1;\nexport const second = () => 2;\n',
		onReview: ({ ruleIds }) => reviewReport([{ rule: ruleIds[0], files: [{ path: 'src/subject.js' }], detail: 'ONE-READ-SENTINEL' }]),
		// every round declines, so cleanup leaves the tree byte-identical
		onRefactor: () => report({ changedFiles: [] }),
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });
	const cleanup = cleanupRecordOf({ steps: result.manifest.steps });

	expectDefined(cleanup);
	// unchanged code is not paid for twice
	expect(reviewScopes).toHaveLength(1);
	expect(cleanup.initialReview.map((finding) => finding.detail)).toStrictEqual(['ONE-READ-SENTINEL']);
	expect(cleanup.finalReview.map((finding) => finding.detail)).toStrictEqual(['ONE-READ-SENTINEL']);
});
