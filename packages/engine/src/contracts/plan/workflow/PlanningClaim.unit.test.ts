import { describe, expect, test } from '@jest/globals';
import { PlanningClaim } from '#src/contracts/index.ts';

const setup = ({ confirmation, historical }: { confirmation: boolean; historical: boolean }) => ({
	id: 'decision',
	kind: 'decision',
	text: 'Keep completed uploads',
	explanation: '',
	contentRevision: 1,
	origin: { artifact: 'notes.md', locator: 'Retry', text: 'Keep completed uploads', sha256: 'a'.repeat(64) },
	owner: 'user',
	state: 'settled',
	dependencies: [],
	scope: { kind: 'whole-plan', claimIds: [], phaseIds: [], packageRoots: [] },
	...(confirmation ? { confirmationId: 'foreground' } : {}),
	...(historical ? { legacySettlementId: 'import' } : {}),
});

describe('PlanningClaim', () => {
	test.each([
		{ confirmation: true, historical: false },
		{ confirmation: false, historical: true },
	])('retains exactly one settlement authority: %j', (variant) => {
		const input = setup(variant);

		const result = PlanningClaim.safeParse(input);

		expect(result).toStrictEqual({ success: true, data: input });
	});
	test.each([
		{ confirmation: false, historical: false },
		{ confirmation: true, historical: true },
	])('rejects missing or conflicting settlement authority: %j', (variant) => {
		const input = setup(variant);

		const result = PlanningClaim.safeParse(input);

		expect(result.success).toBe(false);
		if (!result.success)
			expect(result.error.issues.map((issue) => issue.message)).toContain(
				'Settled user claims require exactly one current confirmation or historical settlement',
			);
	});
});
