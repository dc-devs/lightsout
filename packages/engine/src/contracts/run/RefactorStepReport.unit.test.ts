import { describe, expect, test } from '@jest/globals';
import { RefactorStepReport } from '#src/contracts/index.ts';

const setupFinding = ({
	rule = 'size-file',
	severity = 'blocking',
	siteKey = 'size-file:src/pipeline/steps/refactorStep.ts',
	measure,
}: {
	rule?: string;
	severity?: string;
	siteKey?: string;
	measure?: number;
} = {}) => ({
	rule,
	severity,
	siteKey,
	files: [{ path: 'src/pipeline/steps/refactorStep.ts' }],
	detail: 'the file is over its line cap',
	...(measure === undefined ? {} : { measure }),
});

const setupReport = ({ omit }: { omit?: string } = {}) => {
	const report: Record<string, unknown> = {
		roundsUsed: 2,
		endReason: 'budget-exhausted',
		remaining: [setupFinding({ measure: 310 })],
		inherited: [
			setupFinding({
				rule: 'crowded-folder',
				siteKey: 'crowded-folder:src/pipeline/steps',
				measure: 21,
			}),
		],
		uncertain: [
			setupFinding({
				rule: 'star-re-export',
				severity: 'advisory',
				siteKey: 'star-re-export:src/contracts/index.ts',
			}),
		],
		failures: ['refactor executor timed out after 20 minutes'],
		initialReview: [
			setupFinding({
				rule: 'naming',
				severity: 'advisory',
				siteKey: 'naming:src/pipeline/steps/refactorStep.ts',
			}),
		],
		finalReview: [],
		narration: '1 blocking finding is still standing after 2 rounds',
		lastReport: {
			status: 'complete',
			changedFiles: [{ path: 'src/pipeline/steps/refactorStep.ts', summary: 'split the loop out' }],
			summary: 'tidied what it could',
			failures: [],
		},
	};

	if (omit) {
		delete report[omit];
	}

	return { report };
};

describe('RefactorStepReport', () => {
	test('a cleanup record parses and an unknown end reason is refused', () => {
		const { report } = setupReport();

		const parsed = RefactorStepReport.parse(report);

		// the five reasons are the closed set a report line and a resume narrow on;
		// anything else on the manifest would be a reason no reader can render
		expect(parsed).toEqual(
			expect.objectContaining({
				roundsUsed: 2,
				endReason: 'budget-exhausted',
				remaining: [expect.objectContaining({ siteKey: 'size-file:src/pipeline/steps/refactorStep.ts', measure: 310 })],
				inherited: [expect.objectContaining({ siteKey: 'crowded-folder:src/pipeline/steps' })],
				uncertain: [expect.objectContaining({ siteKey: 'star-re-export:src/contracts/index.ts' })],
				failures: ['refactor executor timed out after 20 minutes'],
				initialReview: [expect.objectContaining({ rule: 'naming' })],
				finalReview: [],
				lastReport: expect.objectContaining({ status: 'complete' }),
			}),
		);
		expect(RefactorStepReport.safeParse({ ...report, endReason: 'gave-up' }).success).toBe(false);
	});

	test('a record with no end reason parses as cleanup still in progress', () => {
		const { report } = setupReport({ omit: 'endReason' });

		const parsed = RefactorStepReport.parse(report);

		// the step writes this record before every executor invocation, so a park
		// or a crash leaves the round count on disk with no reason yet true
		expect(parsed.endReason).toBeUndefined();
		expect(parsed.roundsUsed).toBe(2);
	});
});
