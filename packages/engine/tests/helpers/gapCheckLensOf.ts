import { GapCheckLens } from '#src/contracts/index.ts';
import type { DriverInvocation } from '#src/drivers/index.ts';

/** The lens brief a checker's system prompt was built with — how a spawn is told apart from its two siblings. */
export const gapCheckLensOf = ({ systemPrompt }: DriverInvocation): GapCheckLens | undefined =>
	Object.values(GapCheckLens).find((lens) => (systemPrompt ?? '').includes(`# Your brief: ${lens}`));
