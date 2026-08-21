import { describe, expect, test } from '@jest/globals';
import { ReviewFindingRecord } from '#src/contracts/index.ts';

const setupRecord = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const record: Record<string, unknown> = {
		rule: 'single-return',
		severity: 'advisory',
		siteKey: 'single-return:src/a.ts',
		files: [{ path: 'src/a.ts', startLine: 12 }],
		detail: 'six exits',
		at: '2026-08-20T00:00:00.000Z',
		runId: 'run-01',
		step: 'batch-01:multi-export:src',
		...extra,
	};

	if (omit) {
		delete record[omit];
	}

	return { record };
};

describe('ReviewFindingRecord', () => {
	test('a logged line parses back to the finding the review reported, with its provenance', () => {
		const { record } = setupRecord();

		const parsed = ReviewFindingRecord.parse(record);

		expect(parsed.siteKey).toBe('single-return:src/a.ts');
		expect(parsed.runId).toBe('run-01');
		expect(parsed.step).toBe('batch-01:multi-export:src');
	});

	test.each([{ field: 'at' }, { field: 'runId' }, { field: 'step' }])('rejects a line with no $field', ({ field }) => {
		const { record } = setupRecord({ omit: field });

		// provenance is the whole point of the ledger: a finding nobody can trace
		// to a run and a batch cannot be acted on later
		expect(ReviewFindingRecord.safeParse(record).success).toBe(false);
	});

	test.each([{ field: 'rule' }, { field: 'siteKey' }, { field: 'files' }, { field: 'detail' }])(
		'rejects a line missing the finding’s own $field',
		({ field }) => {
			const { record } = setupRecord({ omit: field });

			expect(ReviewFindingRecord.safeParse(record).success).toBe(false);
		},
	);

	test('a blocking finding is a valid record — the ledger describes what a review saw, not what severity it was', () => {
		const { record } = setupRecord({ extra: { severity: 'blocking' } });

		expect(ReviewFindingRecord.safeParse(record).success).toBe(true);
	});
});
