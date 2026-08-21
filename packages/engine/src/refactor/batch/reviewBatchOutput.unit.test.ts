import { describe, expect, test } from '@jest/globals';
import { type RefactorBatch, type StandardsFinding, StandardsSeverity } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { reviewBatchOutput } from '#src/refactor/batch/index.ts';
import { readReviewFindings } from '#src/runState/index.ts';
import type { LoadedStandardsPackage, LoadedStandardsRule } from '#src/standardsPackages/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

const advisory = (overrides: Partial<StandardsFinding> & { siteKey: string }): StandardsFinding => ({
	rule: 'size-function',
	severity: StandardsSeverity.Advisory,
	files: [{ path: 'src/a.ts' }],
	detail: '81 lines',
	...overrides,
});

const batch: RefactorBatch = {
	id: 'batch-01:multi-export:src',
	rule: 'multi-export',
	folder: 'src',
	blocking: [
		{ rule: 'multi-export', severity: StandardsSeverity.Blocking, siteKey: 'multi-export:src/a.ts', files: [{ path: 'src/a.ts' }], detail: '2 exports' },
	],
	advisories: [],
};

const judgmentRules: LoadedStandardsRule[] = ['size-function', 'single-return'].map((id) => ({
	id,
	set: 'code',
	documentPath: `code/style-guide/patterns/${id}`,
	summary: `the ${id} rule`,
	prose: 'the argument for the rule',
	channel: 'base',
	checked: false,
	defaultSeverity: StandardsSeverity.Advisory,
	defaultSettings: {},
	fixturesPath: `/packages/acme/${id}/fixtures`,
}));

const packages: LoadedStandardsPackage[] = [{ name: 'acme', formatVersion: 1, rootPath: '/packages/acme', documents: [], rules: judgmentRules }];

/** A reviewer that reports whatever the test says it saw, and a progress sink to read back. */
const setupReview = async ({ reported }: { reported: { rule: string; files: { path: string }[]; detail: string }[] }) => {
	const progress: string[] = [];
	const cwd = await freshCwd();
	const driver: Driver = { name: 'stub', invoke: async () => ({ text: JSON.stringify({ findings: reported }), exitCode: 0 }) };

	const call = ({ baseline, changedFiles }: { baseline: StandardsFinding[]; changedFiles: string[] }) =>
		reviewBatchOutput({
			cwd,
			runId: 'run-01',
			driver,
			batch,
			packages,
			channels: [],
			baseline,
			changedFiles,
			agentReview: true,
			timeoutMs: 1000,
			onProgress: (line) => progress.push(line),
		});

	return { call, cwd, progress };
};

describe('reviewBatchOutput', () => {
	test('a rule the pre-edit review already raised on the file is not reported again', async () => {
		const { call } = await setupReview({ reported: [{ rule: 'size-function', files: [{ path: 'src/a.ts' }], detail: '81 lines' }] });

		const introduced = await call({ baseline: [advisory({ siteKey: 'size-function:src/a.ts' })], changedFiles: ['src/a.ts'] });

		// the executor was shown this one before it started and recorded its answer;
		// handing it back is churn, not verification
		expect(introduced).toStrictEqual([]);
	});

	test('a rule that appears only after the edits is the batch’s own doing', async () => {
		const { call } = await setupReview({
			reported: [
				{ rule: 'size-function', files: [{ path: 'src/a.ts' }], detail: '81 lines' },
				{ rule: 'single-return', files: [{ path: 'src/a.ts' }], detail: 'six exits' },
			],
		});

		const introduced = await call({ baseline: [advisory({ siteKey: 'size-function:src/a.ts' })], changedFiles: ['src/a.ts'] });

		expect(introduced.map((entry) => entry.rule)).toStrictEqual(['single-return']);
	});

	test('the same rule on a file the batch created is new — the site key carries the path', async () => {
		const { call } = await setupReview({ reported: [{ rule: 'size-function', files: [{ path: 'src/extracted.ts' }], detail: '92 lines' }] });

		const introduced = await call({ baseline: [advisory({ siteKey: 'size-function:src/a.ts' })], changedFiles: ['src/a.ts', 'src/extracted.ts'] });

		expect(introduced.map((entry) => entry.siteKey)).toStrictEqual(['size-function:src/extracted.ts']);
	});

	test('everything the reviewer saw reaches the repo ledger, not just what is new', async () => {
		const { call, cwd } = await setupReview({
			reported: [
				{ rule: 'size-function', files: [{ path: 'src/a.ts' }], detail: '81 lines' },
				{ rule: 'single-return', files: [{ path: 'src/a.ts' }], detail: 'six exits' },
			],
		});

		await call({ baseline: [advisory({ siteKey: 'size-function:src/a.ts' })], changedFiles: ['src/a.ts'] });
		const recorded = await readReviewFindings({ cwd });

		// the ledger is the account of what a review found, not of what this run
		// chose to act on — and it carries which run and which batch saw it
		expect(recorded.map((entry) => entry.rule)).toStrictEqual(['size-function', 'single-return']);
		expect(recorded[0]?.runId).toBe('run-01');
		expect(recorded[0]?.step).toBe('batch-01:multi-export:src');
	});

	test('the ledger line is written before the caller can act, so a run that dies still leaves the account', async () => {
		const { call, cwd } = await setupReview({ reported: [{ rule: 'single-return', files: [{ path: 'src/a.ts' }], detail: 'six exits' }] });

		await call({ baseline: [], changedFiles: ['src/a.ts'] });

		// a judgment finding has no second witness — no code check can rediscover
		// it — so an unwritten one is simply gone
		expect((await readReviewFindings({ cwd })).map((entry) => entry.siteKey)).toStrictEqual(['single-return:src/a.ts']);
	});

	test('code-checks-only mode spends no agent and writes no ledger line', async () => {
		const cwd = await freshCwd();
		const driver: Driver = {
			name: 'stub',
			invoke: async () => {
				throw new Error('the reviewer must not be invoked when the run opted out');
			},
		};

		const introduced = await reviewBatchOutput({
			cwd,
			runId: 'run-01',
			driver,
			batch,
			packages,
			channels: [],
			baseline: [],
			changedFiles: ['src/a.ts'],
			agentReview: false,
			timeoutMs: 1000,
			onProgress: () => undefined,
		});

		expect(introduced).toStrictEqual([]);
		expect(await readReviewFindings({ cwd })).toStrictEqual([]);
	});

	test('a batch that wrote nothing spends no agent', async () => {
		const progress: string[] = [];
		const driver: Driver = {
			name: 'stub',
			invoke: async () => {
				throw new Error('there is no output to review');
			},
		};

		const introduced = await reviewBatchOutput({
			cwd: await freshCwd(),
			runId: 'run-01',
			driver,
			batch,
			packages,
			channels: [],
			baseline: [],
			changedFiles: [],
			agentReview: true,
			timeoutMs: 1000,
			onProgress: (line) => progress.push(line),
		});

		expect(introduced).toStrictEqual([]);
		expect(progress).toStrictEqual([]);
	});

	test('a review that could not run leaves a note against the batch and blocks nothing', async () => {
		const progress: string[] = [];
		const driver: Driver = { name: 'stub', invoke: async () => ({ text: 'prose, not a report', exitCode: 0 }) };

		const introduced = await reviewBatchOutput({
			cwd: await freshCwd(),
			runId: 'run-01',
			driver,
			batch,
			packages,
			channels: [],
			baseline: [],
			changedFiles: ['src/a.ts'],
			agentReview: true,
			timeoutMs: 1000,
			onProgress: (line) => progress.push(line),
		});

		expect(introduced).toStrictEqual([]);
		expect(progress.some((line) => line.startsWith('batch-01:multi-export:src: agent review skipped — '))).toBe(true);
	});
});
