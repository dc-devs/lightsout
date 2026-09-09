import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { readRunManifest } from '#src/runState/index.ts';
import { cleanupRecordOf } from '#tests/helpers/cleanupRecordOf.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { linkTypescript } from '#tests/helpers/linkTypescript.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { withTestChangeReview } from '#tests/helpers/withTestChangeReview.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

/** The judgment rule ids the standards reviewer was handed, so a stub finding can name one a loaded pack actually declares. */
const ruleIdsOffered = ({ systemPrompt }: { systemPrompt: string }) => [...systemPrompt.matchAll(/Rule id: `([^`]+)`/g)].map(([, id]) => id ?? '');

/**
 * A file well past the 250-line cap: one blocking `size-file` finding whose
 * measure is the line count, which `body` cannot change. Committed before the
 * run, it is debt the pre-edit baseline already carries; rewritten by the run
 * with a different `body`, it is the same site at the same measure.
 */
const oversizedFile = ({ body }: { body: string }) => `export const big = () => ${body};\n${'// padding\n'.repeat(260)}`;

/** The implement step every case gets unless it says otherwise: one new two-export file, a blocking finding the baseline never carried. */
const plantIntroducedFinding = ({ dir }: { dir: string }) => {
	writeSource({ dir, path: 'src/subject.js', source: 'export const first = () => 1;\nexport const second = () => 2;\n' });

	return report({ changedFiles: [{ path: 'src/subject.js', summary: 'feature' }] });
};

/** A cleanup round that really edits the file it was handed without clearing the finding on it, so the round changes the tree and the work list survives it. */
const editWithoutFixing = ({ round, dir }: { round: number; dir: string }) => {
	writeSource({ dir, path: 'src/subject.js', source: `export const first = () => ${round};\nexport const second = () => 2;\n` });

	return report({ changedFiles: [{ path: 'src/subject.js', summary: `round ${round}` }] });
};

/** The two ways a cleanup agent comes back broken: a report that terminated, and one that failed. */
const brokenCleanupReports = [{ status: 'terminated:scope' }, { status: 'failed' }];

interface SetupParams {
	/** Committed sources, planted before any agent runs — whatever they violate is debt the run inherits. */
	sources?: Record<string, string>;
	onImplement?: (params: { dir: string }) => string;
	onReview?: (params: { ruleIds: string[] }) => string;
	onRefactor: (params: { round: number; dir: string }) => string;
	/** The cleanup round the harness answers with a rate limit instead of a report. */
	parkRound?: number;
	/** Extra repo config — where a case sets its own `implement.refactor.max-rounds`. */
	config?: Record<string, unknown>;
}

/**
 * A consumer repo whose implement step plants the debt the case is about and
 * whose cleanup rounds are answered by `onRefactor`, once per round, leaving
 * the bounded cleanup loop as the only thing left to decide the run.
 */
const setupCleanupRun = async ({
	sources,
	onImplement = plantIntroducedFinding,
	onReview = () => reviewReport(),
	onRefactor,
	parkRound,
	config: repoConfig,
}: SetupParams) => {
	const dir = setupConsumerRepo({ config: repoConfig, sources });

	// the line-count rule reads a parsed tree, so the repo needs a compiler
	linkTypescript({ dir });
	let rounds = 0;
	let reviews = 0;
	let lastRefactorText = '';
	const driver: Driver = {
		name: 'stub',
		invoke: withTestChangeReview({
			invoke: async ({ prompt, systemPrompt }) => {
				const role = roleOf(prompt);

				// Answered on the system prompt, so a reviewer that could not report is
				// not mistaken for the role it runs beside on its re-emit retry.
				if ((systemPrompt ?? '').includes('# Role: Standards Reviewer')) {
					if (role === 'standards-review') {
						reviews += 1;
					}

					return { text: onReview({ ruleIds: ruleIdsOffered({ systemPrompt: systemPrompt ?? '' }) }), exitCode: 0 };
				}

				// A re-emit retry carries no role heading of its own, and the cleanup
				// agent is the only remaining role these fixtures let answer off-contract
				// — so it is served the same unusable text again, leaving it no report.
				if (prompt.includes('# Your previous final message')) {
					return { text: lastRefactorText, exitCode: 0 };
				}

				if (role === 'write-tests') {
					mkdirSync(join(dir, 'test'), { recursive: true });
					writeFileSync(join(dir, 'test/subject.test.js'), '// stub test\n');

					return { text: report({ changedFiles: [{ path: 'test/subject.test.js', summary: 'tests' }] }), exitCode: 0 };
				}

				if (role === 'refactor') {
					rounds += 1;

					if (rounds === parkRound) {
						return { text: '', exitCode: 1, rateLimited: true };
					}

					lastRefactorText = onRefactor({ round: rounds, dir });

					return { text: lastRefactorText, exitCode: 0 };
				}

				return { text: onImplement({ dir }), exitCode: 0 };
			},
		}),
	};

	return { dir, driver, config: await readConfig({ cwd: dir }), roundsRun: () => rounds, reviewsRun: () => reviews };
};

describe('runImplementPipeline', () => {
	test('inherited debt alone spawns no cleanup executor and the run carries on', async () => {
		const { dir, driver, config, roundsRun } = await setupCleanupRun({
			sources: { 'src/index.js': 'export const one = 1;\n', 'src/big.js': oversizedFile({ body: '1' }) },
			// The run rewrites the oversized file without changing how long it is,
			// so the live finding sits at the measure the baseline recorded.
			onImplement: ({ dir: cwd }) => {
				writeSource({ dir: cwd, path: 'src/big.js', source: oversizedFile({ body: '2' }) });

				return report({ changedFiles: [{ path: 'src/big.js', summary: 'feature' }] });
			},
			onRefactor: () => report(),
		});

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });
		const record = cleanupRecordOf({ steps: result.manifest.steps });

		expectDefined(record);
		expect(result.ok).toBe(true);
		expect(roundsRun()).toBe(0);
		expect(record).toEqual(expect.objectContaining({ roundsUsed: 0, endReason: 'no-work' }));
		expect(record.inherited.map((finding) => finding.siteKey)).toContain('size-file:src/big.js');
		expect(result.manifest.steps.find((step) => step.id === 'verify-refactor')?.status).toBe('passed');
	});

	test('an introduced blocking finding buys a round and a cleared tree ends clean', async () => {
		const { dir, driver, config, roundsRun } = await setupCleanupRun({
			onRefactor: ({ dir: cwd }) => {
				// The repaired file exports nothing at all, so no finding — not even an
				// advisory about a name or an unused export — survives the round.
				writeFileSync(join(cwd, 'src/subject.js'), "import { one } from './index.js';\n\nconsole.log(one);\n");

				return report({ changedFiles: [{ path: 'src/subject.js', summary: 'split exports' }] });
			},
		});

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });
		const record = cleanupRecordOf({ steps: result.manifest.steps });

		expectDefined(record);
		expect(result.ok).toBe(true);
		expect(roundsRun()).toBe(1);
		expect(record).toEqual(expect.objectContaining({ roundsUsed: 1, endReason: 'clean', remaining: [] }));
	});

	test('a finding standing at the budget ends cleanup without stopping the run', async () => {
		const { dir, driver, config, roundsRun } = await setupCleanupRun({ onRefactor: editWithoutFixing });

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });
		const record = cleanupRecordOf({ steps: result.manifest.steps });
		// the standing finding is recorded, and the run still walks on to the formatter and its last verification
		const cleanupOnwards = result.manifest.steps.filter((step) => ['refactor', 'format-refactor', 'verify-refactor'].includes(step.id));

		expectDefined(record);
		expect(result.ok).toBe(true);
		expect(roundsRun()).toBe(2);
		expect(record).toEqual(expect.objectContaining({ roundsUsed: 2, endReason: 'budget-exhausted' }));
		expect(record.remaining.map((finding) => finding.siteKey)).toContain('multi-export:src/subject.js');
		expect(cleanupOnwards.map((step) => step.status)).toStrictEqual(['passed', 'passed', 'passed']);
	});

	test('the same qualifying work list declined twice ends cleanup early', async () => {
		const { dir, driver, config, roundsRun } = await setupCleanupRun({
			// Four rounds are available; the stable disagreement is what stops it short.
			config: { implement: { refactor: { 'max-rounds': 4 } } },
			onRefactor: () => report({ changedFiles: [] }),
		});

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });
		const record = cleanupRecordOf({ steps: result.manifest.steps });

		expectDefined(record);
		expect(result.ok).toBe(true);
		expect(roundsRun()).toBe(2);
		expect(record).toEqual(expect.objectContaining({ roundsUsed: 2, endReason: 'declined-twice' }));
	});

	test('a stable decline on the exhausting round is recorded as declined-twice', async () => {
		// The same declining fixture at the default budget of two, where the round
		// that makes the disagreement stable is also the round that spends the last
		// of the budget.
		const { dir, driver, config } = await setupCleanupRun({ onRefactor: () => report({ changedFiles: [] }) });

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });
		const record = cleanupRecordOf({ steps: result.manifest.steps });

		expectDefined(record);
		expect(record).toEqual(expect.objectContaining({ roundsUsed: 2, endReason: 'declined-twice' }));
	});

	test('a resumed cleanup continues its round count and reuses its initial review', async () => {
		const { dir, driver, config, reviewsRun } = await setupCleanupRun({
			// A tree the deterministic checks find clean, so the reviewer's opinion is
			// the only thing that can buy the first round.
			onImplement: ({ dir: cwd }) => {
				writeSource({ dir: cwd, path: 'src/subject.js', source: 'export const subject = () => 1;\n' });

				return report({ changedFiles: [{ path: 'src/subject.js', summary: 'feature' }] });
			},
			onReview: ({ ruleIds }) => reviewReport([{ rule: ruleIds[0], files: [{ path: 'src/subject.js' }], detail: 'this name reads oddly to me' }]),
			parkRound: 1,
			onRefactor: () => report({ changedFiles: [] }),
		});
		const parked = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });
		const existing = await readRunManifest({ cwd: dir, runId: parked.manifest.runId });

		const resumed = await runImplementPipeline({ cwd: dir, driver, config, existing });
		const record = cleanupRecordOf({ steps: resumed.manifest.steps });

		expectDefined(record);
		expect(parked.manifest.status).toBe('paused-rate-limit');
		// the parked invocation bought nothing; only the resumed one is charged
		expect(record.roundsUsed).toBe(1);
		// and the resume read the review its predecessor recorded instead of buying a second
		expect(reviewsRun()).toBe(1);
	});

	test.each([
		{ repoConfig: { implement: { refactor: { 'max-rounds': 1 } } }, rounds: 1 },
		{ repoConfig: undefined, rounds: 2 },
	])('the configured max-rounds caps the cleanup executor rounds', async ({ repoConfig, rounds }) => {
		const { dir, driver, config, roundsRun } = await setupCleanupRun({ config: repoConfig, onRefactor: editWithoutFixing });

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });
		const record = cleanupRecordOf({ steps: result.manifest.steps });

		expectDefined(record);
		expect(roundsRun()).toBe(rounds);
		expect(record).toEqual(expect.objectContaining({ roundsUsed: rounds, endReason: 'budget-exhausted' }));
	});

	test.each(brokenCleanupReports)('a cleanup agent failure is recorded and the run proceeds to verification', async ({ status }) => {
		const { dir, driver, config } = await setupCleanupRun({
			onRefactor: ({ dir: cwd }) => {
				// An edit the broken report never mentions: the run has to keep it
				// whatever the agent said about itself.
				writeSource({ dir: cwd, path: 'src/scrap.js', source: 'export const scrap = () => 1;\n' });

				return report({ status, failures: ['CLEANUP-FAILURE-SENTINEL'], changedFiles: [] });
			},
		});

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });
		const record = cleanupRecordOf({ steps: result.manifest.steps });

		expectDefined(record);
		expect(result.ok).toBe(true);
		expect(record.endReason).toBe('agent-failed');
		expect(record.failures.join('\n')).toMatch(/CLEANUP-FAILURE-SENTINEL/);
		expect(result.manifest.changedFiles).toContain('src/scrap.js');
		expect(result.manifest.steps.find((step) => step.id === 'verify-refactor')?.status).toBe('passed');
	});

	test('what cleanup leaves behind is narrated to progress and kept on the record, never as a stop', async () => {
		const { dir, driver, config } = await setupCleanupRun({
			onRefactor: ({ round, dir: cwd }) => {
				writeSource({ dir: cwd, path: 'src/subject.js', source: `export const first = () => ${round};\nexport const second = () => 2;\n` });

				return report({
					changedFiles: [{ path: 'src/subject.js', summary: `round ${round}` }],
					friction: [{ kind: 'friction', area: 'plan', detail: 'SPLITTING-THIS-WOULD-BREAK-THE-PUBLIC-API' }],
				});
			},
		});
		const progress: string[] = [];

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', onProgress: (line) => progress.push(line) });
		const record = cleanupRecordOf({ steps: result.manifest.steps });

		expectDefined(record);
		expectDefined(record.narration);
		// how much stands and how many rounds bought it, the site it stands on, and
		// the agent's own reason for leaving it — the evidence a human acts on later
		expect(record.narration).toMatch(/[1-9]\d* qualifying blocking finding\(s\) still standing after 2 round\(s\)/);
		expect(record.narration).toContain('multi-export:src/subject.js');
		expect(record.narration).toContain('SPLITTING-THIS-WOULD-BREAK-THE-PUBLIC-API');
		// the same account reaches a watching human, and none of it claims the run ended
		expect(progress).toContain(record.narration);
		expect(record.narration).not.toMatch(/escalat|stopped/i);
	});

	test('a cleanup agent that hands back no report at all is recorded as a failure too', async () => {
		const { dir, driver, config, roundsRun } = await setupCleanupRun({
			// Prose where a report belongs, on the invocation and on the re-emit retry
			// it earns — so the round ends with a failure and no report of any kind,
			// the outcome a timeout leaves behind as well.
			onRefactor: ({ dir: cwd }) => {
				writeSource({ dir: cwd, path: 'src/scrap.js', source: 'export const scrap = () => 1;\n' });

				return 'I had a look and it all seemed fine to me.';
			},
		});

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });
		const record = cleanupRecordOf({ steps: result.manifest.steps });

		expectDefined(record);
		expect(result.ok).toBe(true);
		// the invocation returned an outcome, so the round is spent — and there is
		// no report to keep as the account of it
		expect([roundsRun(), record.roundsUsed, record.lastReport]).toStrictEqual([1, 1, undefined]);
		expect(record.endReason).toBe('agent-failed');
		expect(record.failures).toEqual([expect.stringContaining('did not match contract')]);
		// the edit the unreported attempt left behind is found by content anyway
		expect(result.manifest.changedFiles).toContain('src/scrap.js');
		expect(result.manifest.steps.find((step) => step.id === 'verify-refactor')?.status).toBe('passed');
	});

	test('the refactor step record carries the typed cleanup report', async () => {
		const { dir, driver, config } = await setupCleanupRun({
			sources: {
				'src/index.js': 'export const one = 1;\n',
				'src/big.js': oversizedFile({ body: '1' }),
				'src/legacy.js': 'export const third = () => 3;\nexport const fourth = () => 4;\n',
			},
			onImplement: ({ dir: cwd }) => {
				// Three changed files: one whose finding is measured and unchanged, one
				// whose finding carries no measure at all, one whose finding is new.
				writeSource({ dir: cwd, path: 'src/big.js', source: oversizedFile({ body: '2' }) });
				writeSource({ dir: cwd, path: 'src/legacy.js', source: 'export const third = () => 33;\nexport const fourth = () => 4;\n' });
				writeSource({ dir: cwd, path: 'src/subject.js', source: 'export const first = () => 1;\nexport const second = () => 2;\n' });

				return report({ changedFiles: ['src/big.js', 'src/legacy.js', 'src/subject.js'].map((path) => ({ path, summary: 'feature' })) });
			},
			onReview: ({ ruleIds }) => reviewReport([{ rule: ruleIds[0], files: [{ path: 'src/subject.js', startLine: 1 }], detail: 'REVIEW-DETAIL-SENTINEL' }]),
			onRefactor: () => report({ changedFiles: [] }),
		});

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });
		const record = cleanupRecordOf({ steps: result.manifest.steps });

		expectDefined(record);
		expect(record).toEqual(expect.objectContaining({ roundsUsed: 2, endReason: 'declined-twice', failures: [] }));
		expect(record.remaining.map((finding) => finding.siteKey)).toContain('multi-export:src/subject.js');
		expect(record.inherited.map((finding) => finding.siteKey)).toContain('size-file:src/big.js');
		expect(record.uncertain.map((finding) => finding.siteKey)).toContain('multi-export:src/legacy.js');
		// cleanup changed nothing, so the read taken before the first round stands as the final one too
		expect([record.initialReview, record.finalReview]).toEqual([
			[expect.objectContaining({ detail: 'REVIEW-DETAIL-SENTINEL' })],
			[expect.objectContaining({ detail: 'REVIEW-DETAIL-SENTINEL' })],
		]);
	});
});
