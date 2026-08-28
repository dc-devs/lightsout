import type { GradedGap } from '#src/contracts/index.ts';
import { isBlockingGap } from '#src/plan/common/utils/isBlockingGap.ts';

interface Params {
	gaps: GradedGap[];
}

/**
 * The gaps that gate the grade. The verdict reads this rather than
 * `gaps.length`, so a finding a judge ruled the agent can settle can never fail
 * a plan by being counted — the same reason `getBlockingFindings` exists beside
 * the structural findings.
 */
export const getBlockingGaps = ({ gaps }: Params): GradedGap[] => gaps.filter((gap) => isBlockingGap({ gap }));
