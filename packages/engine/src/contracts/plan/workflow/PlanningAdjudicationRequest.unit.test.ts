import { expect, test } from '@jest/globals';
import { PlanningAdjudicationRequest } from '#src/contracts/plan/workflow/PlanningAdjudicationRequest.ts';
import { PlanningVocabulary } from '#src/contracts/plan/workflow/PlanningVocabulary.ts';

const setup = () => ({
	findingIds: ['conflict-a', 'conflict-b'],
	reason: PlanningVocabulary.Dispute.ConflictingReports,
	explanation: 'The two observations require incompatible retry semantics',
	citations: [{ artifact: 'plan.md', quote: 'Retry completed uploads', sha256: 'a'.repeat(64) }],
});

test('preserves each disputed observation and its supporting evidence', () => {
	const input = setup();

	const result = PlanningAdjudicationRequest.parse(input);

	expect(result).toStrictEqual(input);
});

test.each(['findings', 'evidence', 'reason', 'authority'])('refuses an adjudication request lacking explicit %s', (mutation) => {
	const base = setup();
	const input = {
		...base,
		...(mutation === 'findings' ? { findingIds: [] } : {}),
		...(mutation === 'evidence' ? { citations: [] } : {}),
		...(mutation === 'reason' ? { reason: 'ordinary-clear-defect' } : {}),
		...(mutation === 'authority' ? { disposition: 'resolved' } : {}),
	};

	const result = PlanningAdjudicationRequest.safeParse(input);

	expect(result.success).toBe(false);
});
