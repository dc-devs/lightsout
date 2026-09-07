import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type AcceptanceTestRecord, type TestChangeReview, TestDisposition, TestReviewDecision } from '#src/contracts/index.ts';
import { applyTestDispositions } from '#src/pipeline/approvedTests/applyTestDispositions.ts';
import { TestChangeKind } from '#src/pipeline/approvedTests/common/constants/TestChangeKind.ts';
import type { TestChange } from '#src/pipeline/approvedTests/common/types/TestChange.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

type Verdict = TestChangeReview['verdicts'][number];

/** A test file stating exactly the titles it is given, in the shape the title locator reads. */
const sourceHolding = ({ titles }: { titles: string[] }) => titles.map((title) => `test(${JSON.stringify(title)}, () => {});\n`).join('');

const change = ({ path, kind = TestChangeKind.Modified }: { path: string; kind?: TestChangeKind }): TestChange => ({
	path,
	kind,
	diff: `--- approved/${path}\n+++ ${path}\n`,
});

const approve = ({ path, dispositions = [] }: { path: string; dispositions?: Verdict['acceptanceTests'] }): Verdict => ({
	path,
	decision: TestReviewDecision.Approve,
	reason: 'the plan moved the module this test imports',
	acceptanceTests: dispositions,
});

/**
 * A repo on disk holding the given test files, plus the bundle, the verdict and
 * the live mapping the checkpoint would hand the function.
 */
const setupDispositions = ({
	files = {},
	changes = [],
	verdicts = [],
	acceptanceTests = [],
}: {
	files?: Record<string, string[]>;
	changes?: TestChange[];
	verdicts?: Verdict[];
	acceptanceTests?: AcceptanceTestRecord[];
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-dispositions-'));

	for (const [path, titles] of Object.entries(files)) {
		const target = join(cwd, path);

		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, sourceHolding({ titles }));
	}

	const run = { cwd, current: () => ({ runId: 'run-1' }) } as unknown as PipelineRun;

	return { run, changes, review: { verdicts }, acceptanceTests };
};

describe('applyTestDispositions', () => {
	test('applyTestDispositions: a bundled path with no verdict is rejected as unreviewed', async () => {
		const params = setupDispositions({
			files: { 'src/widget.unit.test.ts': ['widget: renders its label'] },
			changes: [change({ path: 'src/widget.unit.test.ts' })],
			verdicts: [],
			acceptanceTests: [
				{ criterion: 'The widget renders its label', testFile: 'src/widget.unit.test.ts', testName: 'widget: renders its label', gate: 'test' },
			],
		});

		const result = await applyTestDispositions(params);

		// a change nobody judged is not a change anybody approved, so the file is
		// never recorded as approved and the checkpoint goes red
		expect(result.rejections).toEqual([expect.stringContaining('src/widget.unit.test.ts')]);
		expect(result.approvedPaths).toStrictEqual([]);
	});

	test('applyTestDispositions: a verdict for a path outside the bundle changes nothing', async () => {
		const params = setupDispositions({
			files: { 'src/widget.unit.test.ts': ['widget: renders its label'] },
			changes: [],
			verdicts: [
				approve({
					path: 'src/stranger.unit.test.ts',
					dispositions: [{ testName: 'widget: renders its label', disposition: TestDisposition.Renamed, newTestName: 'widget: paints its label' }],
				}),
			],
			acceptanceTests: [
				{ criterion: 'The widget renders its label', testFile: 'src/widget.unit.test.ts', testName: 'widget: renders its label', gate: 'test' },
			],
		});

		const result = await applyTestDispositions(params);

		// a reviewer cannot approve a file the engine never showed it, nor rename an
		// acceptance test from a verdict about some other file
		expect(result.rejections).toStrictEqual([]);
		expect(result.approvedPaths).toStrictEqual([]);
		expect(result.acceptanceTests).toStrictEqual([
			{ criterion: 'The widget renders its label', testFile: 'src/widget.unit.test.ts', testName: 'widget: renders its label', gate: 'test' },
		]);
	});

	test("applyTestDispositions: a reject verdict names the file, the reviewer's reason and the acceptance tests in it", async () => {
		const params = setupDispositions({
			files: { 'src/widget.unit.test.ts': ['widget: renders its label', 'widget: hides when empty'] },
			changes: [change({ path: 'src/widget.unit.test.ts' })],
			verdicts: [
				{
					path: 'src/widget.unit.test.ts',
					decision: TestReviewDecision.Reject,
					reason: 'the label assertion was replaced with toBeDefined',
					acceptanceTests: [],
				},
			],
			acceptanceTests: [
				{ criterion: 'The widget renders its label', testFile: 'src/widget.unit.test.ts', testName: 'widget: renders its label', gate: 'test' },
				{ criterion: 'The widget hides when empty', testFile: 'src/widget.unit.test.ts', testName: 'widget: hides when empty', gate: 'test' },
			],
		});

		const result = await applyTestDispositions(params);

		const rejection = result.rejections.join('\n');

		// the fix role gets the file, why it was refused, and which acceptance tests
		// ride on it — enough to repair without re-reading the verdict
		expect(result.rejections).toHaveLength(1);
		expect(rejection).toContain('src/widget.unit.test.ts');
		expect(rejection).toContain('the label assertion was replaced with toBeDefined');
		expect(rejection).toContain('widget: renders its label');
		expect(rejection).toContain('widget: hides when empty');
		expect(result.approvedPaths).toStrictEqual([]);
	});

	test('applyTestDispositions: renamed, moved and replaced rewrite the mapping while criterion and gate stand', async () => {
		const params = setupDispositions({
			files: {
				'src/renamed.unit.test.ts': ['renamed: the widget paints its label'],
				'src/movedDestination.unit.test.ts': ['moved: the widget hides when empty'],
				'src/replacedDestination.unit.test.ts': ['replaced: the widget reports its size'],
			},
			changes: [
				change({ path: 'src/renamed.unit.test.ts' }),
				change({ path: 'src/moved.unit.test.ts', kind: TestChangeKind.Removed }),
				change({ path: 'src/replaced.unit.test.ts', kind: TestChangeKind.Removed }),
				change({ path: 'src/movedDestination.unit.test.ts', kind: TestChangeKind.Added }),
				change({ path: 'src/replacedDestination.unit.test.ts', kind: TestChangeKind.Added }),
			],
			verdicts: [
				approve({
					path: 'src/renamed.unit.test.ts',
					dispositions: [
						{ testName: 'renamed: the widget renders its label', disposition: TestDisposition.Renamed, newTestName: 'renamed: the widget paints its label' },
					],
				}),
				approve({
					path: 'src/moved.unit.test.ts',
					dispositions: [{ testName: 'moved: the widget hides when empty', disposition: TestDisposition.Moved, testFile: 'src/movedDestination.unit.test.ts' }],
				}),
				approve({
					path: 'src/replaced.unit.test.ts',
					dispositions: [
						{
							testName: 'replaced: the widget measures itself',
							disposition: TestDisposition.Replaced,
							testFile: 'src/replacedDestination.unit.test.ts',
							newTestName: 'replaced: the widget reports its size',
						},
					],
				}),
				approve({ path: 'src/movedDestination.unit.test.ts' }),
				approve({ path: 'src/replacedDestination.unit.test.ts' }),
			],
			acceptanceTests: [
				{ criterion: 'The widget renders its label', testFile: 'src/renamed.unit.test.ts', testName: 'renamed: the widget renders its label', gate: 'test' },
				{ criterion: 'The widget hides when empty', testFile: 'src/moved.unit.test.ts', testName: 'moved: the widget hides when empty', gate: 'unit' },
				{ criterion: 'The widget reports its size', testFile: 'src/replaced.unit.test.ts', testName: 'replaced: the widget measures itself', gate: 'test' },
			],
		});

		const result = await applyTestDispositions(params);

		// the criterion is what the plan asked for and the gate is what proves it —
		// a disposition moves the name and the file, never the requirement
		expect(result.rejections).toStrictEqual([]);
		expect(result.acceptanceTests).toStrictEqual([
			{ criterion: 'The widget renders its label', testFile: 'src/renamed.unit.test.ts', testName: 'renamed: the widget paints its label', gate: 'test' },
			{ criterion: 'The widget hides when empty', testFile: 'src/movedDestination.unit.test.ts', testName: 'moved: the widget hides when empty', gate: 'unit' },
			{
				criterion: 'The widget reports its size',
				testFile: 'src/replacedDestination.unit.test.ts',
				testName: 'replaced: the widget reports its size',
				gate: 'test',
			},
		]);
	});

	test('applyTestDispositions: a disposition pointing outside the test-side files is rejected', async () => {
		const params = setupDispositions({
			files: { 'src/widget.unit.test.ts': ['widget: renders its label'] },
			changes: [change({ path: 'src/widget.unit.test.ts' })],
			verdicts: [
				approve({
					path: 'src/widget.unit.test.ts',
					dispositions: [{ testName: 'widget: renders its label', disposition: TestDisposition.Moved, testFile: 'src/widget.ts' }],
				}),
			],
			acceptanceTests: [
				{ criterion: 'The widget renders its label', testFile: 'src/widget.unit.test.ts', testName: 'widget: renders its label', gate: 'test' },
			],
		});

		const result = await applyTestDispositions(params);

		// an acceptance test parked in a production file is a test nothing collects,
		// so the mapping may only ever point at test-side paths
		expect(result.rejections.join('\n')).toContain('src/widget.ts');
	});

	test('applyTestDispositions: an acceptance test the locator cannot find after the dispositions overrides the approval', async () => {
		const params = setupDispositions({
			files: { 'src/widget.unit.test.ts': ['widget: renders its label'] },
			changes: [change({ path: 'src/widget.unit.test.ts' })],
			verdicts: [
				approve({
					path: 'src/widget.unit.test.ts',
					dispositions: [{ testName: 'widget: renders its label', disposition: TestDisposition.Renamed, newTestName: 'widget: paints its label' }],
				}),
			],
			acceptanceTests: [
				{ criterion: 'The widget renders its label', testFile: 'src/widget.unit.test.ts', testName: 'widget: renders its label', gate: 'test' },
			],
		});

		const result = await applyTestDispositions(params);

		const rejection = result.rejections.join('\n');

		// the reviewer said the test was renamed and the file says otherwise; the
		// deterministic check is what makes an approval a guarantee, not a word
		expect(result.rejections).toHaveLength(1);
		expect(rejection).toContain('The widget renders its label');
		expect(rejection).toContain('src/widget.unit.test.ts');
		expect(rejection).toContain('widget: paints its label');
	});

	test('applyTestDispositions: an acceptance test with no disposition is treated as kept and still has to be found', async () => {
		const params = setupDispositions({
			files: { 'src/widget.unit.test.ts': ['widget: renders its label'] },
			changes: [change({ path: 'src/widget.unit.test.ts' })],
			verdicts: [approve({ path: 'src/widget.unit.test.ts' })],
			acceptanceTests: [
				{ criterion: 'The widget renders its label', testFile: 'src/widget.unit.test.ts', testName: 'widget: renders its label', gate: 'test' },
				{ criterion: 'The widget hides when empty', testFile: 'src/widget.unit.test.ts', testName: 'widget: hides when empty', gate: 'test' },
			],
		});

		const result = await applyTestDispositions(params);

		// a reviewer that forgot a row cannot lose it: both rows stay exactly as the
		// mapping stated them, and the locator still answers for each one
		expect(result.acceptanceTests).toStrictEqual([
			{ criterion: 'The widget renders its label', testFile: 'src/widget.unit.test.ts', testName: 'widget: renders its label', gate: 'test' },
			{ criterion: 'The widget hides when empty', testFile: 'src/widget.unit.test.ts', testName: 'widget: hides when empty', gate: 'test' },
		]);
		expect(result.rejections).toHaveLength(1);
		expect(result.rejections.join('\n')).toContain('widget: hides when empty');
	});
});
