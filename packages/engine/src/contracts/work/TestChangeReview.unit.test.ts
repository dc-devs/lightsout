import { describe, expect, test } from '@jest/globals';
import { TestChangeReview } from '#src/contracts/index.ts';

const setupVerdict = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const verdict: Record<string, unknown> = {
		path: 'packages/engine/src/gates/runGates.unit.test.ts',
		decision: 'approve',
		reason: 'the import moved with the module the plan moved, and every assertion stands',
		...extra,
	};

	if (omit) {
		delete verdict[omit];
	}

	return { review: { verdicts: [verdict] } };
};

const setupDispositions = ({ acceptanceTests }: { acceptanceTests?: Record<string, unknown>[] } = {}) => {
	const verdict: Record<string, unknown> = {
		path: 'packages/engine/src/gates/runGates.unit.test.ts',
		decision: 'approve',
		reason: 'the plan renames the subject, so the case is renamed with it',
	};

	if (acceptanceTests) {
		verdict.acceptanceTests = acceptanceTests;
	}

	return { review: { verdicts: [verdict] } };
};

describe('TestChangeReview', () => {
	test('TestChangeReview: a verdict needs a path, a known decision and a reason, and an unknown decision fails', () => {
		const { review } = setupVerdict();

		const parsed = TestChangeReview.parse(review);

		// the three fields the engine reads off every verdict survive the parse
		expect(parsed.verdicts[0]).toStrictEqual({
			path: 'packages/engine/src/gates/runGates.unit.test.ts',
			decision: 'approve',
			reason: 'the import moved with the module the plan moved, and every assertion stands',
			acceptanceTests: [],
		});
		// a rejection is the other half of the vocabulary, and it needs a reason too
		expect(TestChangeReview.parse(setupVerdict({ extra: { decision: 'reject' } }).review).verdicts[0].decision).toBe('reject');
		// a verdict the engine cannot attach to a bundled path is unusable
		expect(TestChangeReview.safeParse(setupVerdict({ omit: 'path' }).review).success).toBe(false);
		expect(TestChangeReview.safeParse(setupVerdict({ extra: { path: '' } }).review).success).toBe(false);
		// an approval has to say what made the change legitimate, so a missing or
		// empty reason is refused for both decisions
		expect(TestChangeReview.safeParse(setupVerdict({ omit: 'reason' }).review).success).toBe(false);
		expect(TestChangeReview.safeParse(setupVerdict({ extra: { reason: '' } }).review).success).toBe(false);
		// a decision the engine has no branch for is caught at the agent boundary
		expect(TestChangeReview.safeParse(setupVerdict({ omit: 'decision' }).review).success).toBe(false);
		expect(TestChangeReview.safeParse(setupVerdict({ extra: { decision: 'defer' } }).review).success).toBe(false);
		expect(TestChangeReview.safeParse(setupVerdict({ extra: { decision: 'Approve' } }).review).success).toBe(false);
	});

	test('TestChangeReview: dispositions default to empty and round-trip the new test name and test file', () => {
		const { review } = setupDispositions({
			acceptanceTests: [
				{ testName: 'runGates: a failing gate stops the batch', disposition: 'kept' },
				{ testName: 'runGates: a green gate records its evidence', disposition: 'renamed', newTestName: 'runGates: a green gate writes its evidence' },
				{ testName: 'runGates: a timeout is a failure', disposition: 'moved', testFile: 'packages/engine/src/gates/runGates.timeout.unit.test.ts' },
				{
					testName: 'runGates: an override drops a gate',
					disposition: 'replaced',
					newTestName: 'runGates: a dropped gate is skipped with a progress line',
					testFile: 'packages/engine/src/gates/buildGateStages.unit.test.ts',
				},
			],
		});

		const parsed = TestChangeReview.parse(review);

		// each of the four dispositions round-trips with the fields its kind carries,
		// because the engine rewrites the live mapping from exactly these values
		expect(parsed.verdicts[0].acceptanceTests).toStrictEqual([
			{ testName: 'runGates: a failing gate stops the batch', disposition: 'kept' },
			{ testName: 'runGates: a green gate records its evidence', disposition: 'renamed', newTestName: 'runGates: a green gate writes its evidence' },
			{ testName: 'runGates: a timeout is a failure', disposition: 'moved', testFile: 'packages/engine/src/gates/runGates.timeout.unit.test.ts' },
			{
				testName: 'runGates: an override drops a gate',
				disposition: 'replaced',
				newTestName: 'runGates: a dropped gate is skipped with a progress line',
				testFile: 'packages/engine/src/gates/buildGateStages.unit.test.ts',
			},
		]);
		// a file holding no acceptance test names none, and the reader gets a list
		// rather than undefined
		expect(TestChangeReview.parse(setupDispositions().review).verdicts[0].acceptanceTests).toStrictEqual([]);
		// a disposition the engine has no rule for is refused
		expect(
			TestChangeReview.safeParse(
				setupDispositions({ acceptanceTests: [{ testName: 'runGates: a failing gate stops the batch', disposition: 'deleted' }] }).review,
			).success,
		).toBe(false);
		// and a disposition that names no test cannot be applied to the mapping
		expect(TestChangeReview.safeParse(setupDispositions({ acceptanceTests: [{ disposition: 'kept' }] }).review).success).toBe(false);
		expect(TestChangeReview.safeParse(setupDispositions({ acceptanceTests: [{ testName: '', disposition: 'kept' }] }).review).success).toBe(false);
	});
});
