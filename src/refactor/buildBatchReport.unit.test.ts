import { describe, expect, test } from '@jest/globals';
import { buildBatchReport } from '@/refactor/buildBatchReport';

describe('buildBatchReport', () => {
	test('carries both accounts a batch keeps — what persisted, and why', () => {
		const report = buildBatchReport({
			outcome: 'declined',
			remainingSiteKeys: ['multi-export:src/a.ts'],
			rationale: ['[plan] the barrel would break'],
			advisoryOutcomes: [{ rule: 'size-function', siteKey: 'size-function:src/a.ts', outcome: 'declined', reason: 'orchestration exemption' }],
		});

		expect(report).toStrictEqual({
			outcome: 'declined',
			remainingSiteKeys: ['multi-export:src/a.ts'],
			rationale: ['[plan] the barrel would break'],
			advisoryOutcomes: [{ rule: 'size-function', siteKey: 'size-function:src/a.ts', outcome: 'declined', reason: 'orchestration exemption' }],
		});
	});

	test('an empty advisory account is omitted, not written as an empty list', () => {
		const report = buildBatchReport({ outcome: 'resolved', remainingSiteKeys: [], rationale: [], advisoryOutcomes: [] });

		// a batch shown no advice and one whose agent said nothing are the same
		// absence — and the same absence an older manifest carries
		expect(report).toStrictEqual({ outcome: 'resolved', remainingSiteKeys: [], rationale: [] });
	});
});
