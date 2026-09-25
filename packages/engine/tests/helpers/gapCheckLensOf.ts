import { GapCheckLens } from '#src/contracts/plan/grade/GapCheckLens.ts';
import type { DriverInvocation } from '#src/drivers/common/types/DriverInvocation.ts';

/** The lens brief a checker's system prompt was built with — how a spawn is told apart from its two siblings. */
export const gapCheckLensOf = ({ systemPrompt }: DriverInvocation): GapCheckLens | undefined =>
	Object.values(GapCheckLens).find((lens) => (systemPrompt ?? '').includes(`# Your brief: ${lens}`));
