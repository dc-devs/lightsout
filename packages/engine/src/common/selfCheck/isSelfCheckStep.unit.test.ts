import { describe, expect, test } from '@jest/globals';
import { buildSelfCheckStep } from '#src/common/selfCheck/buildSelfCheckStep.ts';
import { isSelfCheckStep } from '#src/common/selfCheck/isSelfCheckStep.ts';

describe('isSelfCheckStep', () => {
	test.each([
		// a writing agent's own check, at the step it was spawned for and at that
		// step's fix re-invocation
		{ step: 'self-check-implement', expected: true },
		{ step: 'self-check-verify-refactor', expected: true },
		// the run's own gate work, which the summary must keep billing for
		{ step: 'implement', expected: false },
		{ step: 'verify-implement', expected: false },
		// the name is read from the front, so a step that merely holds the words
		// is still the run's own work
		{ step: 'verify-self-check-implement', expected: false },
	])('reads $step as a self-check step: $expected', ({ step, expected }) => {
		const selfCheck = isSelfCheckStep({ step });

		expect(selfCheck).toBe(expected);
	});

	test("reads a record written outside any step as the run's own gate work", () => {
		const selfCheck = isSelfCheckStep({ step: undefined });

		// an unnamed execution is never subtracted from the run's gate figures
		expect(selfCheck).toBe(false);
	});

	test('recognises the step name its own builder writes, so the pair can never drift apart', () => {
		const written = buildSelfCheckStep({ step: 'refactor' });

		const selfCheck = isSelfCheckStep({ step: written });

		expect(selfCheck).toBe(true);
	});
});
