import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { loadConfig } from '#src/common/utils/loadConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runRefactorPipeline } from '#src/refactor/index.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

/** Two exported consts in one file — a compiler-free structure finding (multi-export). */
const multiExport = 'export const alphaThing = 1;\nexport const betaThing = 2;\n';

/** The rule ids the standards reviewer was handed, in the order its invocation lists them. */
const ruleIdsOffered = ({ systemPrompt }: { systemPrompt: string }) => [...systemPrompt.matchAll(/Rule id: `([^`]+)`/g)].map(([, id]) => id ?? '');

/** The repo-relative files the standards reviewer was asked to read. */
const filesOffered = ({ prompt }: { prompt: string }) =>
	prompt
		.split('\n')
		.filter((line) => line.startsWith('- '))
		.map((line) => line.slice(2));

/**
 * A refactor run over one multi-export finding per named folder — one batch
 * each — whose executor always resolves its batch's finding, leaving the
 * standards reviewer, answered by `onReview`, as the only thing under test.
 * The default answer is the empty report every test that is not about a review
 * finding wants.
 */
const setupReviewedRun = async ({
	folders = ['src'],
	onReview = () => reviewReport(),
}: {
	folders?: string[];
	onReview?: (params: { ruleIds: string[] }) => string;
} = {}) => {
	const dir = setupConsumerRepo();

	for (const folder of folders) {
		mkdirSync(join(dir, folder), { recursive: true });
		writeSource({ dir, path: `${folder}/multi.ts`, source: multiExport });
	}

	execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm fixture', { cwd: dir });

	const executorPrompts: string[] = [];
	const reviewScopes: string[][] = [];
	const reviewRuleIds: string[][] = [];
	const progress: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt, systemPrompt }) => {
			// A rejected report comes back as a re-emit invocation, which carries no
			// role marker of its own. The reviewer answers it the same way it
			// answered the first time, so a reviewer that cannot produce a
			// contract-shaped report stays unreported instead of being rescued by
			// the executor branch below.
			if (prompt.includes('# Re-emit your report')) {
				return { text: onReview({ ruleIds: ruleIdsOffered({ systemPrompt: systemPrompt ?? '' }) }), exitCode: 0 };
			}

			if (roleOf(prompt) === 'standards-review') {
				const ruleIds = ruleIdsOffered({ systemPrompt: systemPrompt ?? '' });

				reviewScopes.push(filesOffered({ prompt }));
				reviewRuleIds.push(ruleIds);

				return { text: onReview({ ruleIds }), exitCode: 0 };
			}

			executorPrompts.push(prompt);

			const folder = prompt.match(/^- (\S+)\/multi\.ts$/m)?.[1] ?? '';

			writeSource({ dir, path: `${folder}/multi.ts`, source: 'export const alphaThing = 1;\n' });
			writeFileSync(join(dir, folder, 'betaThing.ts'), 'export const betaThing = 2;\n');

			return {
				text: report({
					changedFiles: [
						{ path: `${folder}/multi.ts`, summary: 'split' },
						{ path: `${folder}/betaThing.ts`, summary: 'split' },
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
		executorPrompts,
		reviewScopes,
		reviewRuleIds,
		progress,
		onProgress: (message: string) => progress.push(message),
	};
};

/** A review finding on the batch's own file, named for a rule the reviewer was actually handed. */
const reviewFinding = ({ ruleIds }: { ruleIds: string[] }) =>
	reviewReport([{ rule: ruleIds[0], files: [{ path: 'src/multi.ts', startLine: 2 }], detail: 'REVIEW-DETAIL-SENTINEL', guidance: 'REVIEW-GUIDANCE-SENTINEL' }]);

describe('runRefactorPipeline agent review', () => {
	test('the reviewer’s findings join the advisory list the batch’s executor is handed', async () => {
		const { dir, driver, config, executorPrompts } = await setupReviewedRun({ onReview: reviewFinding });

		await runRefactorPipeline({ cwd: dir, driver, config });

		// under the advisory heading, sited by the engine and carrying both halves
		// of its text — judgment handed to a judge, never blocking work
		expect(executorPrompts[0] ?? '').toMatch(/Advisory —[\s\S]*- \[[^\]]+] src\/multi\.ts:2 — REVIEW-DETAIL-SENTINEL — REVIEW-GUIDANCE-SENTINEL/);
	});

	test('the batch’s executor is asked to account for each advisory it was shown', async () => {
		const { dir, driver, config, executorPrompts } = await setupReviewedRun({ onReview: reviewFinding });

		await runRefactorPipeline({ cwd: dir, driver, config });

		// a batch persists that answer, so a batch is a caller that may ask for it
		expect(executorPrompts[0] ?? '').toContain('# Report what you did about each advisory');
	});

	test('each batch is reviewed against its own files', async () => {
		const { dir, driver, config, reviewScopes } = await setupReviewedRun({ folders: ['alpha', 'beta'] });

		await runRefactorPipeline({ cwd: dir, driver, config });

		// a reviewer reading the whole repo per batch would spend the run's budget
		// re-reading files no one is working on
		expect(reviewScopes).toStrictEqual([['alpha/multi.ts'], ['beta/multi.ts']]);
	});

	test('every batch reads the same judgment rules — the run resolves them once', async () => {
		const { dir, driver, config, reviewRuleIds } = await setupReviewedRun({ folders: ['alpha', 'beta'] });

		await runRefactorPipeline({ cwd: dir, driver, config });

		// non-empty first, or two empty lists would agree about nothing
		expect(reviewRuleIds[0]?.length ?? 0).toBeGreaterThan(0);
		expect(reviewRuleIds[1]).toStrictEqual(reviewRuleIds[0]);
	});

	test('with the agent review off, no reviewer is invoked and the run says so once', async () => {
		const { dir, driver, config, reviewScopes, progress, onProgress } = await setupReviewedRun({
			onReview: () => {
				throw new Error('the reviewer must not be invoked when the run opted out');
			},
		});

		const result = await runRefactorPipeline({ cwd: dir, driver, config, agentReview: false, onProgress });

		expect(result.ok).toBe(true);
		expect(reviewScopes).toStrictEqual([]);
		expect(progress).toContain('code checks only — the per-batch agent review is off for this run');
	});

	test('a review that could not run is narrated against its batch and the batch is still worked', async () => {
		const { dir, driver, config, progress, onProgress } = await setupReviewedRun({ onReview: () => 'the harness fell over' });

		const result = await runRefactorPipeline({ cwd: dir, driver, config, onProgress });

		// the batch is real work — a missing answer must not stop it
		expect(result.ok).toBe(true);
		expect(progress.some((line) => line.startsWith('batch-01:multi-export:src: agent review skipped —'))).toBe(true);
	});
});
