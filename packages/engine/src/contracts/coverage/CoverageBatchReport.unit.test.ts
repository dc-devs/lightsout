import { describe, expect, test } from '@jest/globals';
import { CoverageBatchReport } from '@/contracts';

describe('CoverageBatchReport', () => {
	test('a resolved report carries the before and after percentage of every file the batch tracked', () => {
		const parsed = CoverageBatchReport.parse({
			outcome: 'resolved',
			files: [
				{ path: 'src/a.ts', beforePct: 10, afterPct: 74 },
				{ path: 'src/b.ts', beforePct: 40, afterPct: 40 },
			],
			rationale: [],
		});

		expect(parsed.outcome).toBe('resolved');
		// the unmoved file is what the per-file strike rule reads on resume
		expect(parsed.files[1]).toStrictEqual({ path: 'src/b.ts', beforePct: 40, afterPct: 40 });
	});

	test('a declined report parses with the agent rationale the human review reads', () => {
		const parsed = CoverageBatchReport.parse({
			outcome: 'declined',
			files: [{ path: 'src/a.ts', beforePct: 10, afterPct: 10 }],
			rationale: ['[failed] the module cannot be tested without splitting it'],
		});

		expect(parsed.rationale).toStrictEqual(['[failed] the module cannot be tested without splitting it']);
	});

	test('an outcome outside the two the engine records is refused', () => {
		// 'partial' would silently become an unhandled state in the decline streak
		expect(CoverageBatchReport.safeParse({ outcome: 'partial', files: [], rationale: [] }).success).toBe(false);
	});

	test('the outcome carries the recorded value, not the capitalized key it is written from', () => {
		// BatchOutcome's keys are Resolved and Declined; the persisted values are lowercase
		expect(CoverageBatchReport.safeParse({ outcome: 'Resolved', files: [], rationale: [] }).success).toBe(false);
	});

	test('a report missing any of the three fields is refused rather than read as a batch with nothing to say', () => {
		for (const report of [
			{ files: [], rationale: [] },
			{ outcome: 'resolved', rationale: [] },
			{ outcome: 'resolved', files: [] },
		]) {
			// resume reads outcome for the decline streak, files for the per-file
			// strikes, and rationale for the human — an absent field would parse as a
			// batch that resolved everything and set nothing aside
			expect(CoverageBatchReport.safeParse(report).success).toBe(false);
		}
	});

	test('a non-numeric percentage on either side of the improvement comparison is refused', () => {
		for (const file of [
			{ path: 'src/a.ts', beforePct: 'Unknown', afterPct: 40 },
			{ path: 'src/a.ts', beforePct: 10, afterPct: null },
		]) {
			// the strike rule reads afterPct > beforePct — a string would compare as
			// text, so a file that never moved could read as improved
			expect(CoverageBatchReport.safeParse({ outcome: 'resolved', files: [file], rationale: [] }).success).toBe(false);
		}
	});

	test('a tracked file with no usable path is refused, because set-aside and strikes are keyed by path', () => {
		for (const file of [
			{ beforePct: 10, afterPct: 40 },
			{ path: 12, beforePct: 10, afterPct: 40 },
		]) {
			expect(CoverageBatchReport.safeParse({ outcome: 'declined', files: [file], rationale: [] }).success).toBe(false);
		}
	});

	test('a single value where either list belongs is refused, not read as a one-entry list', () => {
		expect(CoverageBatchReport.safeParse({ outcome: 'declined', files: { path: 'src/a.ts', beforePct: 10, afterPct: 10 }, rationale: [] }).success).toBe(false);
		// rationale lines are printed to the human verbatim, so a structured entry
		// would render as [object Object]
		expect(CoverageBatchReport.safeParse({ outcome: 'declined', files: [], rationale: 'needs a source change' }).success).toBe(false);
		expect(CoverageBatchReport.safeParse({ outcome: 'declined', files: [], rationale: [{ reason: 'needs a source change' }] }).success).toBe(false);
	});

	test('a batch that tracked no file and offered no account is still a report', () => {
		const parsed = CoverageBatchReport.parse({ outcome: 'resolved', files: [], rationale: [] });

		// neither list carries a minimum — the pipeline reads files.length and hands
		// rationale straight to the set-aside section
		expect(parsed).toStrictEqual({ outcome: 'resolved', files: [], rationale: [] });
	});

	test('fields the step record keeps beside the report are dropped when the persisted step is read back', () => {
		const parsed = CoverageBatchReport.parse({
			outcome: 'declined',
			files: [{ path: 'src/a.ts', beforePct: 10, afterPct: 10 }],
			rationale: ['[scope] the boundary file sits outside this batch'],
			changedFiles: ['src/a.unit.test.ts'],
			batchId: 'batch-01:root',
		});

		expect(parsed).toStrictEqual({
			outcome: 'declined',
			files: [{ path: 'src/a.ts', beforePct: 10, afterPct: 10 }],
			rationale: ['[scope] the boundary file sits outside this batch'],
		});
	});

	test('a step that carries no report at all is refused rather than throwing', () => {
		for (const value of [undefined, null, 'resolved', ['resolved']]) {
			// resume runs every batch step through safeParse, including steps that
			// stopped before a report was ever written
			expect(CoverageBatchReport.safeParse(value).success).toBe(false);
		}
	});
});
