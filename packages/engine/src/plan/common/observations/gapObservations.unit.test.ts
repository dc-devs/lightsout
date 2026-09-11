import { describe, expect, test } from '@jest/globals';
import { GapArea, GapCheckLens, type GapObservation, GapOutcome, type GradedGap } from '#src/contracts/index.ts';
import { gapObservations } from '#src/plan/common/observations/gapObservations.ts';

/** Two observations a confirmed group carries, worded differently from the gap's own representative fields. */
const carriedObservations: GapObservation[] = [
	{
		phase: 'phase-1-reader.md',
		lens: GapCheckLens.Surface,
		area: GapArea.UnderspecifiedSurface,
		gap: 'the schema names no timeout field',
		decision: 'whether the timeout lives on the schema',
		options: ['add it', 'leave it out'],
	},
	{
		phase: 'phase-2-writer.md',
		lens: GapCheckLens.Wiring,
		area: GapArea.PhaseSeamMismatch,
		gap: 'the writer reads a timeout the schema never declares',
		decision: 'where the timeout is declared',
		options: [],
	},
];

/** One judged gap, varying only the observations it carries. */
const setupGap = ({ observations }: { observations: GapObservation[] }): { gap: GradedGap } => ({
	gap: {
		phase: 'phase-1-reader.md',
		lens: GapCheckLens.Decisions,
		area: GapArea.OmittedDecision,
		gap: 'the timeout is declared in neither phase consistently',
		decision: 'one home for the timeout',
		options: ['schema', 'writer'],
		outcome: GapOutcome.NeedsAHuman,
		humanDecision: 'pick the home for the timeout',
		findingId: 'f1',
		observations,
	},
});

describe('gapObservations', () => {
	test('returns the observations a gap carries unchanged', () => {
		const { gap } = setupGap({ observations: carriedObservations });

		const observations = gapObservations({ gap });

		expect(observations).toStrictEqual(carriedObservations);
	});

	test('synthesises one observation from the identity of a gap that carries none', () => {
		const { gap } = setupGap({ observations: [] });

		const observations = gapObservations({ gap });

		// a single reader's finding still stands for its own location: reading an
		// empty list as nothing would drop that location from any record it joins,
		// and the judge's ruling and record id are not part of what was observed
		expect(observations).toStrictEqual([
			{
				phase: 'phase-1-reader.md',
				lens: GapCheckLens.Decisions,
				area: GapArea.OmittedDecision,
				gap: 'the timeout is declared in neither phase consistently',
				decision: 'one home for the timeout',
				options: ['schema', 'writer'],
			},
		]);
	});
});
