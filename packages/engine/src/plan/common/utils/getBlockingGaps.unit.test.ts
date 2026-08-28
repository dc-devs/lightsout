import { describe, expect, test } from '@jest/globals';
import { GapArea, GapCheckLens, GapOutcome, type GradedGap } from '#src/contracts/index.ts';
import { getBlockingGaps } from '#src/plan/common/utils/getBlockingGaps.ts';

/** One gap per outcome given, each identifiable by its gap text so order is assertable. */
const setupGaps = ({ outcomes }: { outcomes: GapOutcome[] }) => {
	const gaps: GradedGap[] = outcomes.map((outcome, index) => ({
		area: GapArea.OmittedDecision,
		gap: `gap ${index + 1}`,
		decision: `decision ${index + 1}`,
		options: [],
		phase: 'plan.md',
		lens: GapCheckLens.Decisions,
		outcome,
	}));

	return { gaps };
};

describe('getBlockingGaps', () => {
	test('only the findings a human must settle and the ones nobody judged come back, in reader order', () => {
		const { gaps } = setupGaps({
			outcomes: [GapOutcome.AgentCanDecide, GapOutcome.NeedsAHuman, GapOutcome.AlreadyAnswered, GapOutcome.Unjudged],
		});

		const blocking = getBlockingGaps({ gaps });

		// a note counted here would fail a plan whose only findings the implementing
		// agent can settle — the whole reason the verdict reads this rather than a
		// length
		expect(blocking.map((gap) => gap.gap)).toStrictEqual(['gap 2', 'gap 4']);
	});

	test.each<{ label: string; outcomes: GapOutcome[] }>([
		{ label: 'findings the agent can settle', outcomes: [GapOutcome.AgentCanDecide, GapOutcome.AgentCanDecide] },
		{ label: 'nothing at all', outcomes: [] },
	])('$label gates nothing', ({ outcomes }) => {
		const { gaps } = setupGaps({ outcomes });

		expect(getBlockingGaps({ gaps })).toStrictEqual([]);
	});
});
