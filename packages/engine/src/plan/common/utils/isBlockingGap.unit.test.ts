import { describe, expect, test } from '@jest/globals';
import { GapArea, GapCheckLens, GapOutcome, type GradedGap } from '#src/contracts/index.ts';
import { isBlockingGap } from '#src/plan/common/utils/isBlockingGap.ts';

/** One judged gap, carrying only the outcome each case turns on. */
const setupGap = ({ outcome }: { outcome: GapOutcome }): { gap: GradedGap } => ({
	gap: {
		area: GapArea.OmittedDecision,
		gap: 'the plan picks no failure mode',
		decision: 'what to return when the judge times out',
		options: [],
		phase: 'plan.md',
		lens: GapCheckLens.Decisions,
		outcome,
	},
});

describe('isBlockingGap', () => {
	test.each<{ outcome: GapOutcome; blocks: boolean }>([
		{ outcome: GapOutcome.NeedsAHuman, blocks: true },
		{ outcome: GapOutcome.Unjudged, blocks: true },
		{ outcome: GapOutcome.AgentCanDecide, blocks: false },
		{ outcome: GapOutcome.AlreadyAnswered, blocks: false },
	])('$outcome blocks: $blocks', ({ outcome, blocks }) => {
		const { gap } = setupGap({ outcome });

		// only a finding a human must settle — or one nobody weighed — gates the
		// grade; the other two are notes
		expect(isBlockingGap({ gap })).toBe(blocks);
	});
});
