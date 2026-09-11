import { describe, expect, test } from '@jest/globals';
import { GapArea, GapCheckLens, type GapObservation } from '#src/contracts/index.ts';
import { findingLocations } from '#src/plan/common/utils/findingLocations.ts';

/** One reader's observation at one plan file, carrying only the phase each case turns on. */
const setupObservation = ({ phase, gap }: { phase: string; gap: string }): GapObservation => ({
	area: GapArea.OmittedDecision,
	gap,
	decision: 'what to return when the judge times out',
	options: [],
	phase,
	lens: GapCheckLens.Decisions,
});

const cases: Array<{ observations: GapObservation[]; phase: string; expected: string[] }> = [
	{
		// second file listed first, and the second file observed twice
		observations: [
			setupObservation({ phase: 'phase-2.md', gap: 'the retry count is never stated' }),
			setupObservation({ phase: 'phase-1.md', gap: 'the retry count contradicts phase 2' }),
			setupObservation({ phase: 'phase-2.md', gap: 'the retry backoff is never stated' }),
		],
		phase: 'phase-1.md',
		expected: ['phase-2.md', 'phase-1.md'],
	},
	{
		observations: [],
		phase: 'phase-3.md',
		expected: ['phase-3.md'],
	},
];

describe('findingLocations', () => {
	test.each(cases)("returns distinct locations in first-appearance order and falls back to the finding's own phase", ({ observations, phase, expected }) => {
		const locations = findingLocations({ observations, phase });

		expect(locations).toStrictEqual(expected);
	});
});
