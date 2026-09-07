import { describe, expect, test } from '@jest/globals';
import { TestReviewRecord } from '#src/contracts/index.ts';

/** One journal line: the checkpoint that ran the review, when, what it decided, and what it went red on. */
const setupLine = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const line: Record<string, unknown> = {
		checkpoint: 'verify-implement',
		at: '2026-01-01T00:00:00.000Z',
		verdicts: [
			{
				path: 'packages/engine/src/pipeline/steps/verifyStep.testReview.unit.test.ts',
				decision: 'approve',
				reason: 'The import moved with the module the plan moved.',
				acceptanceTests: [
					{
						testName: 'verifyStep: a refused review goes red under the review family and no gate command runs',
						disposition: 'kept',
					},
				],
			},
		],
		...extra,
	};

	if (omit) {
		delete line[omit];
	}

	return { line };
};

describe('TestReviewRecord', () => {
	test('TestReviewRecord: a line carries the checkpoint, the time, the verdicts and the rejections', () => {
		const { line } = setupLine({
			extra: { rejections: ['packages/engine/src/gates/runGates.unit.test.ts: the assertion was weakened to toBeDefined()'] },
		});

		const parsed = TestReviewRecord.parse(line);

		expect(parsed).toStrictEqual({
			checkpoint: 'verify-implement',
			at: '2026-01-01T00:00:00.000Z',
			verdicts: [
				{
					path: 'packages/engine/src/pipeline/steps/verifyStep.testReview.unit.test.ts',
					decision: 'approve',
					reason: 'The import moved with the module the plan moved.',
					acceptanceTests: [
						{
							testName: 'verifyStep: a refused review goes red under the review family and no gate command runs',
							disposition: 'kept',
						},
					],
				},
			],
			rejections: ['packages/engine/src/gates/runGates.unit.test.ts: the assertion was weakened to toBeDefined()'],
		});

		// a clean review is still journalled, so the empty rejection list is a
		// default rather than something every writer has to remember to state
		const { line: clean } = setupLine();

		expect(TestReviewRecord.parse(clean).rejections).toStrictEqual([]);

		// the line is the run's evidence that a review happened at a named
		// checkpoint at a named time, so neither may be missing or blank
		for (const field of ['checkpoint', 'at', 'verdicts']) {
			const { line: missing } = setupLine({ omit: field });

			expect(TestReviewRecord.safeParse(missing).success).toBe(false);
		}
		for (const field of ['checkpoint', 'at']) {
			const { line: blank } = setupLine({ extra: { [field]: '' } });

			expect(TestReviewRecord.safeParse(blank).success).toBe(false);
		}

		// the verdicts are the reviewer's own shape — a decision outside the two
		// the contract names would journal a judgment the engine cannot act on
		const { line: unknownDecision } = setupLine({
			extra: { verdicts: [{ path: 'a.unit.test.ts', decision: 'maybe', reason: 'unsure' }] },
		});

		expect(TestReviewRecord.safeParse(unknownDecision).success).toBe(false);

		// an empty review — no file differed from its approved version — is a
		// legitimate line, and its verdict list stays empty rather than absent
		const { line: nothingChanged } = setupLine({ extra: { verdicts: [] } });

		expect(TestReviewRecord.parse(nothingChanged).verdicts).toStrictEqual([]);
	});
});
