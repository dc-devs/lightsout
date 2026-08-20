import { describe, expect, test } from '@jest/globals';
import { summarizeStepReport } from '#src/features/runDetail/index.ts';

const setupReport = ({ report }: { report?: unknown } = {}) => ({ report });

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

	test('shows a report matching no contract as the JSON the manifest stores', () => {
		const { report } = setupReport({ report: { shape: 'nobody anticipated' } });

		const summary = summarizeStepReport({ report });

		expect(summary).toStrictEqual({ kind: 'raw', text: '{\n  "shape": "nobody anticipated"\n}' });
	});
});
