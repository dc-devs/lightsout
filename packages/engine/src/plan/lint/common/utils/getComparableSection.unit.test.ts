import { describe, expect, test } from '@jest/globals';
import { getComparableSection } from '#src/plan/lint/common/utils/getComparableSection.ts';

/**
 * One section as a file carries it: every line padded with trailing spaces, one
 * blank line in the middle of the body, and two blank lines closing it. A
 * currency check has to see through the padding and the trailing blanks — how a
 * section joins the heading below it belongs to the writer — while the interior
 * blank is content the section itself states.
 */
const setupSection = () => ({
	lines: ['## Global Constraints  ', '   ', '- the machinery is restructured, not patched around\t', '', '- a second rule  ', '', '  '],
});

describe('getComparableSection', () => {
	test('getComparableSection: trailing spaces and trailing blank lines are dropped while interior blank lines are kept', () => {
		const { lines } = setupSection();

		const comparable = getComparableSection({ lines });

		expect(comparable).toBe('## Global Constraints\n\n- the machinery is restructured, not patched around\n\n- a second rule');
	});
});
