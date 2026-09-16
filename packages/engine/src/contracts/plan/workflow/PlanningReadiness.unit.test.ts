import { expect, test } from '@jest/globals';
import { PlanningReadiness } from '#src/contracts/index.ts';

const setup = ({ variant }: { variant: number }) => {
	const input = {
		target: 'implementation',
		ready: true,
		generation: 'a'.repeat(64),
		inputDigest: 'b'.repeat(64),
		structuralFailures: [],
		uncoveredClaimIds: [],
		openBlockerIds: [],
		unresolvedQuestionIds: [],
		integrationReceiptId: 'r1',
	};
	const cases = [
		input,
		{ ...input, structuralFailures: ['Missing acceptance mapping'] },
		{ ...input, uncoveredClaimIds: ['c1'] },
		{ ...input, openBlockerIds: ['f1'] },
		{ ...input, unresolvedQuestionIds: ['q1'] },
		{ ...input, integrationReceiptId: undefined },
		{ ...input, missingReason: 'No independent review' },
	];
	return { input: cases[variant], expected: variant === 0 };
};

test.each([0, 1, 2, 3, 4, 5, 6])('cannot declare readiness while obligations remain', (variant) => {
	const { input, expected } = setup({ variant });

	const result = PlanningReadiness.safeParse(input);

	expect(result.success).toBe(expected);
});
