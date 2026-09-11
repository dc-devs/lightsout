import { describe, expect, test } from '@jest/globals';
import { distinctiveWords } from '#src/plan/common/grading/distinctiveWords.ts';

/** A finding that mixes the short grading vocabulary every finding carries with the longer words that identify its defect. */
const setupFinding = () => {
	const text = 'Plan phase: the Manifest file-writer contradicts MANIFEST; agent gap in phases.';

	return { text };
};

describe('distinctiveWords', () => {
	test('drops words shorter than six characters and lower-cases the rest', () => {
		const { text } = setupFinding();

		const words = distinctiveWords({ text });

		expect(words).toStrictEqual(new Set(['manifest', 'writer', 'contradicts', 'phases']));
	});
});
