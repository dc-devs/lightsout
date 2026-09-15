import { expect, test } from '@jest/globals';
import { PlanningUnknownAssessment } from '#src/contracts/plan/workflow/PlanningUnknownAssessment.ts';
import { PlanningVocabulary } from '#src/contracts/plan/workflow/PlanningVocabulary.ts';

const setup = ({ unavailable = false } = {}) => ({
	dependencyIds: ['unknown-membership'],
	claimIds: ['retention'],
	outcome: unavailable ? PlanningVocabulary.UnknownAssessment.Unavailable : PlanningVocabulary.UnknownAssessment.Unnecessary,
	reason: 'The observed adapter establishes this isolated retry contract',
	paths: unavailable ? ['private/adapter.ts'] : [],
	evidenceIds: ['adapter-source'],
	citations: unavailable ? [] : [{ artifact: 'adapter.ts', quote: 'preserveCompleted', sha256: 'a'.repeat(64) }],
});

test.each([false, true])('retains a concrete current unknown-reach assessment (unavailable=%s)', (unavailable) => {
	const input = setup({ unavailable });

	const result = PlanningUnknownAssessment.parse(input);

	expect(result).toStrictEqual(input);
});

test.each([false, true])('refuses assurance without the supporting citation or unavailable path (unavailable=%s)', (unavailable) => {
	const input = { ...setup({ unavailable }), paths: [], citations: [] };

	const result = PlanningUnknownAssessment.safeParse(input);

	expect(result.success).toBe(false);
});
