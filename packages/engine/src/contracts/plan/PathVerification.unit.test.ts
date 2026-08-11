import { describe, expect, test } from '@jest/globals';
import { PathVerification } from '@/contracts';

const setupVerification = (overrides: Record<string, unknown> = {}) => {
	const verification = {
		pathsChecked: 4,
		missingPaths: ['src/plan/runPlanGapCheck.ts'],
		scriptsChecked: 2,
		missingScripts: ['test-unit'],
		createPathsThatExist: ['src/plan/verifyFacts.ts'],
		...overrides,
	};

	return { verification };
};

describe('PathVerification', () => {
	test('a full verification parses with its counts and miss lists intact', () => {
		const { verification } = setupVerification();

		const parsed = PathVerification.parse(verification);

		expect(parsed).toStrictEqual({
			pathsChecked: 4,
			missingPaths: ['src/plan/runPlanGapCheck.ts'],
			scriptsChecked: 2,
			missingScripts: ['test-unit'],
			createPathsThatExist: ['src/plan/verifyFacts.ts'],
		});
	});

	test('the three miss lists default to empty — a clean check is still a verification', () => {
		const parsed = PathVerification.parse({ pathsChecked: 4, scriptsChecked: 2 });

		// every claim resolving on disk reads back as empty lists, not as absent
		// fields
		expect(parsed).toStrictEqual({ pathsChecked: 4, missingPaths: [], scriptsChecked: 2, missingScripts: [], createPathsThatExist: [] });
	});

	test('zero checks parse — an authored facts file with no paths to verify is a valid result', () => {
		const parsed = PathVerification.parse({ pathsChecked: 0, scriptsChecked: 0 });

		expect(parsed).toStrictEqual({ pathsChecked: 0, missingPaths: [], scriptsChecked: 0, missingScripts: [], createPathsThatExist: [] });
	});

	for (const field of ['pathsChecked', 'scriptsChecked']) {
		test(`rejects a verification missing ${field}`, () => {
			const { verification } = setupVerification({ [field]: undefined });

			const result = PathVerification.safeParse(verification);

			// ${field} is required — the count is what distinguishes "nothing missing"
			// from "nothing checked"
			expect(result.success).toBe(false);
		});
	}

	for (const field of ['pathsChecked', 'scriptsChecked']) {
		test(`rejects a string ${field} rather than coercing it to a number`, () => {
			const { verification } = setupVerification({ [field]: '4' });

			const result = PathVerification.safeParse(verification);

			// the counts are produced in code, so a stringly-typed count means the file
			// was hand-edited
			expect(result.success).toBe(false);
		});
	}

	for (const field of ['missingPaths', 'missingScripts', 'createPathsThatExist']) {
		test(`rejects a non-string entry in ${field}`, () => {
			const { verification } = setupVerification({ [field]: [42] });

			const result = PathVerification.safeParse(verification);

			// the miss lists are rendered back to the human verbatim
			expect(result.success).toBe(false);
		});
	}

	test('unknown keys are stripped', () => {
		const { verification } = setupVerification();

		const parsed = PathVerification.parse({ ...verification, checkedAt: '2026-08-04T00:00:00.000Z' });

		// the timestamp lives on PlanFacts as verifiedAt, not on the verification
		// block
		expect('checkedAt' in parsed).toBe(false);
	});
});
