import { describe, expect, test } from '@jest/globals';
import { summarizeStepReport } from '#src/features/runDetail/index.ts';

const setupReport = ({ report }: { report?: unknown } = {}) => ({ report });

const finding = ({ rule, siteKey }: { rule: string; siteKey: string }) => ({
	rule,
	severity: 'blocking',
	siteKey,
	files: [{ path: siteKey }],
	detail: 'over the cap',
});

describe('summarizeStepReport', () => {
	test('says nothing when the step recorded no report', () => {
		const { report } = setupReport();

		const summary = summarizeStepReport({ report });

		expect(summary).toBeUndefined();
	});

	test('reads a refactor batch as its outcome and what it left behind', () => {
		const { report } = setupReport({ report: { outcome: 'resolved', remainingSiteKeys: ['a', 'b'], rationale: ['the second site is a false positive'] } });

		const summary = summarizeStepReport({ report });

		expect(summary).toStrictEqual({
			kind: 'batch',
			outcome: 'resolved',
			remaining: 2,
			rationale: ['the second site is a false positive'],
			advisories: [],
		});
	});

	test('carries through what a batch did about each advisory it was shown', () => {
		const { report } = setupReport({
			report: {
				outcome: 'declined',
				remainingSiteKeys: [],
				rationale: [],
				advisoryOutcomes: [{ rule: 'size-function', siteKey: 'src/a.ts:doThing', outcome: 'declined', reason: 'the split would hide the flow' }],
			},
		});

		const summary = summarizeStepReport({ report });

		expect(summary).toEqual(
			expect.objectContaining({
				advisories: [{ rule: 'size-function', siteKey: 'src/a.ts:doThing', outcome: 'declined', reason: 'the split would hide the flow' }],
			}),
		);
	});

	test('reads a coordinator step as the child run that implemented its phase', () => {
		const { report } = setupReport({ report: { runId: 'abcdef0123456789' } });

		const summary = summarizeStepReport({ report });

		expect(summary).toStrictEqual({ kind: 'phase', runId: 'abcdef0123456789' });
	});

	test('reads a writers envelope as how many batches ran, how they ended and what they touched', () => {
		const { report } = setupReport({
			report: {
				reports: [
					{ status: 'complete', summary: 'covered the reader', changedFiles: [{ path: 'src/a.unit.test.ts', summary: 'new' }], failures: [] },
					{ status: 'failed', summary: 'the gate would not pass', changedFiles: [], failures: ['coverage still short'] },
				],
			},
		});

		const summary = summarizeStepReport({ report });

		expect(summary).toStrictEqual({
			kind: 'writers',
			count: 2,
			fileCount: 1,
			statuses: { complete: 1, failed: 1 },
			summaries: ['covered the reader', 'the gate would not pass'],
		});
	});

	test('adds up the batches that ended the same way rather than keeping only the last', () => {
		const { report } = setupReport({
			report: {
				reports: [
					{ status: 'complete', summary: 'covered the reader', changedFiles: [], failures: [] },
					{ status: 'complete', summary: 'covered the writer', changedFiles: [], failures: [] },
				],
			},
		});

		const summary = summarizeStepReport({ report });

		expect(summary).toEqual(expect.objectContaining({ count: 2, statuses: { complete: 2 } }));
	});

	test("reads a working agent's own report as what it changed and what fought it", () => {
		const { report } = setupReport({
			report: { status: 'complete', summary: 'added the run detail route', changedFiles: [{ path: 'src/routes/runs.$runId.tsx', summary: 'the page' }] },
		});

		const summary = summarizeStepReport({ report });

		expect(summary).toStrictEqual({
			kind: 'work',
			status: 'complete',
			summary: 'added the run detail route',
			files: [{ path: 'src/routes/runs.$runId.tsx', summary: 'the page' }],
			failures: [],
		});
	});

	test('reads a cleanup record as what it spent, why it ended and what it left behind', () => {
		const { report } = setupReport({
			report: {
				roundsUsed: 2,
				endReason: 'budget-exhausted',
				remaining: [finding({ rule: 'size-file', siteKey: 'src/a.ts' })],
				inherited: [finding({ rule: 'crowded-folder', siteKey: 'src/legacy' })],
				uncertain: [finding({ rule: 'size-function', siteKey: 'src/b.ts:doThing' })],
				failures: ['the second round timed out'],
				initialReview: [finding({ rule: 'naming', siteKey: 'src/a.ts:thing' })],
				finalReview: [
					finding({ rule: 'naming', siteKey: 'src/a.ts:thing' }),
					finding({ rule: 'naming', siteKey: 'src/b.ts:other' }),
					finding({ rule: 'naming', siteKey: 'src/c.ts:third' }),
				],
				lastReport: {
					status: 'complete',
					changedFiles: [{ path: 'src/a.ts', summary: 'split the reader out' }],
					summary: 'split the oversized reader',
					failures: [],
				},
			},
		});

		const summary = summarizeStepReport({ report });

		expect(summary).toStrictEqual({
			kind: 'cleanup',
			rounds: 2,
			endReason: 'budget-exhausted',
			remaining: 1,
			carried: 2,
			reviewFindings: 3,
			failures: ['the second round timed out'],
			summary: 'split the oversized reader',
		});
	});

	test('reads a mid-loop cleanup record as cleanup still in progress', () => {
		const { report } = setupReport({
			report: {
				roundsUsed: 1,
				remaining: [finding({ rule: 'size-file', siteKey: 'src/a.ts' })],
				inherited: [],
				uncertain: [],
				failures: [],
				initialReview: [],
				finalReview: [],
			},
		});

		const summary = summarizeStepReport({ report });

		expect(summary).toStrictEqual({
			kind: 'cleanup',
			rounds: 1,
			endReason: undefined,
			remaining: 1,
			carried: 0,
			reviewFindings: 0,
			failures: [],
			summary: undefined,
		});
	});

	test('shows a report matching no contract as the JSON the manifest stores', () => {
		const { report } = setupReport({ report: { shape: 'nobody anticipated' } });

		const summary = summarizeStepReport({ report });

		expect(summary).toStrictEqual({ kind: 'raw', text: '{\n  "shape": "nobody anticipated"\n}' });
	});
});
