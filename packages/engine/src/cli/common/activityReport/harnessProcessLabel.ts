import type { HarnessProcessMark } from '#src/contracts/activity/HarnessProcessMark.ts';

interface Params {
	process: HarnessProcessMark;
}

/**
 * What a harness process ran as: the harness that ran it, the model it was
 * given and the effort it ran at, each dropped when it was never requested
 * rather than shown as an empty slot.
 *
 * Both surfaces that name a process spell it through this one function — the
 * tree's leaf rows and the outlier section beneath them — because a reader
 * takes an outlier line back to the row it came from by matching the two
 * spellings, and two spellings built separately eventually stop matching.
 */
export const harnessProcessLabel = ({ process }: Params): string =>
	[process.harness, ...(process.model === undefined ? [] : [process.model]), ...(process.effort === undefined ? [] : [process.effort])].join(' · ');
