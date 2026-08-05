import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DedupReport } from '@/contracts';

const setupReport = (overrides: Record<string, unknown> = {}) => {
	const finding = {
		plannedSymbol: 'formatDate',
		plannedPath: 'src/plan/common/utils/formatDate.ts',
		recommendation: 'extract',
		rationale: 'the planned symbol restates an existing utility',
		collidesWith: [{ name: 'formatDate', path: 'src/common/utils/formatDate.ts' }],
	};
	const report = {
		planName: 'packages-to-src',
		findings: [finding],
		reviewedAt: '2026-08-04T00:00:00.000Z',
		...overrides,
	};

	return { report, finding };
};

describe('DedupReport', () => {
	test('a persisted report parses with its findings intact', () => {
		const { report } = setupReport();

		const parsed = DedupReport.parse(report);

		assert.deepEqual(parsed, {
			planName: 'packages-to-src',
			reviewedAt: '2026-08-04T00:00:00.000Z',
			findings: [
				{
					plannedSymbol: 'formatDate',
					plannedPath: 'src/plan/common/utils/formatDate.ts',
					recommendation: 'extract',
					rationale: 'the planned symbol restates an existing utility',
					collidesWith: [{ name: 'formatDate', path: 'src/common/utils/formatDate.ts' }],
					migrateCallers: [],
				},
			],
		});
	});

	test('findings defaults to empty — the clean result is still a report', () => {
		const parsed = DedupReport.parse({ planName: 'packages-to-src', reviewedAt: '2026-08-04T00:00:00.000Z' });

		assert.deepEqual(parsed.findings, [], 'no candidates detected and every candidate ruled distinct both read back as an empty findings array');
	});

	test('an explicitly empty findings array parses', () => {
		const { report } = setupReport({ findings: [] });

		const parsed = DedupReport.parse(report);

		assert.deepEqual(parsed.findings, []);
	});

	test('nested finding defaults are applied when dedup.json is read back', () => {
		const { report } = setupReport({
			findings: [{ plannedSymbol: 'formatDate', plannedPath: 'src/plan/formatDate.ts', recommendation: 'reuse', rationale: 'an identical utility already exists' }],
		});

		const parsed = DedupReport.parse(report);

		assert.deepEqual(
			parsed.findings[0],
			{
				plannedSymbol: 'formatDate',
				plannedPath: 'src/plan/formatDate.ts',
				recommendation: 'reuse',
				rationale: 'an identical utility already exists',
				collidesWith: [],
				migrateCallers: [],
			},
			'the skill reads both arrays off every finding without guarding for absence',
		);
	});

	test('an isDuplicate on a nested finding is stripped', () => {
		const { report, finding } = setupReport();

		const parsed = DedupReport.parse({ ...report, findings: [{ ...finding, isDuplicate: true }] });

		assert.equal('isDuplicate' in (parsed.findings[0] ?? {}), false, 'the omit holds through the nesting — a hand-edited dedup.json still reads as findings, not verdicts');
	});

	test('rejects a report missing planName or reviewedAt', () => {
		for (const field of ['planName', 'reviewedAt']) {
			const { report } = setupReport({ [field]: undefined });

			const result = DedupReport.safeParse(report);

			assert.equal(result.success, false, `${field} is required — planName keys the report to its plan workspace and reviewedAt tells the human whether the review predates their latest plan edit`);
		}
	});

	test('rejects a non-string reviewedAt rather than coercing a timestamp', () => {
		const { report } = setupReport({ reviewedAt: 1780531200000 });

		const result = DedupReport.safeParse(report);

		assert.equal(result.success, false, 'the field is the ISO string runPlanDedup writes, so the JSON round-trips unchanged');
	});

	test('one malformed finding rejects the whole report', () => {
		const { report } = setupReport({ findings: [{ plannedSymbol: 'formatDate', recommendation: 'extract', rationale: 'this entry has no plannedPath' }] });

		const result = DedupReport.safeParse(report);

		assert.equal(result.success, false, 'a partly readable dedup.json is refused at the read boundary rather than driving a half-blank review');
	});

	test('rejects a findings value that is not an array', () => {
		const { report, finding } = setupReport();

		const result = DedupReport.safeParse({ ...report, findings: finding });

		assert.equal(result.success, false, 'a single finding object in place of the list is a malformed report');
	});
});
