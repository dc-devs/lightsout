import { execSync } from 'node:child_process';
import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import { type RefactorBatch, StandardsSeverity } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runBatch } from '#src/refactor/batch/index.ts';
import { runStandardsCheck } from '#src/standardsCheck/index.ts';
import type { LoadedStandardsPack } from '#src/standardsPacks/index.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

/**
 * One judgment-only rule in one pack — the run's packs, which runBatch owns the
 * threading of: they reach the pre-edit read through collectBatchAdvisories and
 * the read of what the batch wrote through the tools it builds.
 */
const judgmentPacks: LoadedStandardsPack[] = [
	{
		name: 'acme',
		formatVersion: 1,
		rootPath: '/packages/acme',
		documents: [],
		rules: [
			{
				id: 'single-return',
				set: 'code',
				documentPath: 'code/style-guide/patterns/single-return',
				summary: 'more than one exit from a function',
				prose: 'the argument for the rule',
				channel: 'base',
				checked: false,
				defaultSeverity: StandardsSeverity.Advisory,
				defaultSettings: {},
				fixturesPath: '/packages/acme/single-return/fixtures',
			},
		],
	},
];

/** Split a multi-export file in two, each half with the caller that uses it — an unreferenced half is its own blocking finding. */
const splitFile = ({ dir, file, first, second }: { dir: string; file: string; first: string; second: string }) => {
	writeSource({ dir, path: file, source: `export const ${first} = 1;\n` });
	writeSource({ dir, path: file.replace(/[^/]+\.ts$/, `${second}.ts`), source: `export const ${second} = 2;\n` });
};

/**
 * A repo with two multi-export findings in ONE folder — a single batch of two
 * sites, the arrangement a partial pass and its requeue need — and the batch
 * object a run would freeze for it, built from a live check so the site keys
 * are the ones the re-check will answer with rather than ones a test invented.
 *
 * `answer` is the executor's reply for each pass in turn: it edits the tree and
 * returns the report it claims for that edit, which is the whole of what the
 * batch loop reads.
 */
const setupBatch = async ({ answer, packs = [] }: { answer: (params: { pass: number; dir: string }) => string; packs?: LoadedStandardsPack[] }) => {
	const dir = setupConsumerRepo();

	writeSource({ dir, path: 'src/one.ts', source: 'export const alphaOne = 1;\nexport const betaOne = 2;\n' });
	writeSource({ dir, path: 'src/two.ts', source: 'export const alphaTwo = 1;\nexport const betaTwo = 2;\n' });
	execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm fixture', { cwd: dir });

	const { findings } = await runStandardsCheck({ cwd: dir, persist: false });
	const batch: RefactorBatch = {
		id: 'batch-01:multi-export:src',
		rule: 'multi-export',
		folder: 'src',
		blocking: findings.filter((finding) => finding.rule === 'multi-export'),
		advisories: [],
	};
	const executorPrompts: string[] = [];
	const reviewSystemPrompts: string[] = [];
	const config = await readConfig({ cwd: dir });
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt, systemPrompt }) => {
			if (roleOf(prompt) === 'standards-review') {
				reviewSystemPrompts.push(systemPrompt ?? '');

				return { text: reviewReport(), exitCode: 0 };
			}

			executorPrompts.push(prompt);

			return { text: answer({ pass: executorPrompts.length, dir }), exitCode: 0 };
		},
	};

	const run = () =>
		runBatch({
			cwd: dir,
			runId: 'run-01',
			driver,
			config,
			batch,
			packs,
			channels: [],
			checkAll: false,
			agentReview: true,
			agentTimeoutMs: 60_000,
			attributedFiles: [],
			onProgress: () => undefined,
			recordUsage: async () => undefined,
		});

	return { run, executorPrompts, reviewSystemPrompts };
};

describe('runBatch', () => {
	test('a requeue that changes the tree and still leaves a site standing spends the budget and declines', async () => {
		const { run, executorPrompts } = await setupBatch({
			answer: ({ pass, dir }) => {
				if (pass === 1) {
					splitFile({ dir, file: 'src/one.ts', first: 'alphaOne', second: 'betaOne' });

					return report({ changedFiles: [{ path: 'src/one.ts', summary: 'split' }] });
				}

				// The requeue writes — so this is not the changed-nothing decline the
				// pass itself settles — but it never resolves the site it was handed,
				// which leaves the loop's own budget ceiling as the only way out.
				writeSource({ dir, path: 'src/two.ts', source: 'export const alphaTwo = 1;\nexport const gammaTwo = 3;\n' });

				return report({ changedFiles: [{ path: 'src/two.ts', summary: 'renamed a half' }] });
			},
		});

		const stop = await run();

		expect(stop.kind === 'done' && stop.report).toStrictEqual({ outcome: 'declined', remainingSiteKeys: ['multi-export:src/two.ts'], rationale: [] });
		// two passes, never a third — the ceiling is the loop's, not the pass's
		expect(executorPrompts.length).toBe(2);
	});

	test('a pass that clears every site resolves the batch with nothing left standing', async () => {
		const { run } = await setupBatch({
			answer: ({ dir }) => {
				splitFile({ dir, file: 'src/one.ts', first: 'alphaOne', second: 'betaOne' });
				splitFile({ dir, file: 'src/two.ts', first: 'alphaTwo', second: 'betaTwo' });

				return report({ changedFiles: ['src/one.ts', 'src/betaOne.ts', 'src/two.ts', 'src/betaTwo.ts'].map((path) => ({ path, summary: 'split' })) });
			},
		});

		const stop = await run();

		expect(stop.kind === 'done' && stop.report).toStrictEqual({ outcome: 'resolved', remainingSiteKeys: [], rationale: [] });
	});

	test('the run’s packs reach both the pre-edit read and the read of what the batch wrote', async () => {
		const { run, reviewSystemPrompts } = await setupBatch({
			packs: judgmentPacks,
			answer: ({ dir }) => {
				splitFile({ dir, file: 'src/one.ts', first: 'alphaOne', second: 'betaOne' });
				splitFile({ dir, file: 'src/two.ts', first: 'alphaTwo', second: 'betaTwo' });

				return report({ changedFiles: ['src/one.ts', 'src/betaOne.ts', 'src/two.ts', 'src/betaTwo.ts'].map((path) => ({ path, summary: 'split' })) });
			},
		});

		await run();

		// the same judgment rules on both sides of the edits — a batch reviewed
		// against a different set afterwards could report its own baseline as new
		expect(reviewSystemPrompts.map((systemPrompt) => systemPrompt.includes('Rule id: `single-return`'))).toStrictEqual([true, true]);
	});
});
