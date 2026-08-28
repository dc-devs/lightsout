import { GapOutcome, type GradedGap } from '#src/contracts/index.ts';

interface Params {
	gap: GradedGap;
}

/**
 * Whether one judged gap gates the grade: a judge ruled it needs a human, or
 * nobody judged it. Spelled once because the verdict, the terminal report and
 * the count printed beside it all ask the same question, and three copies are
 * three chances for one to stop recognising the unjudged half.
 */
export const isBlockingGap = ({ gap }: Params): boolean => gap.outcome === GapOutcome.NeedsAHuman || gap.outcome === GapOutcome.Unjudged;
