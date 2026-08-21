import type { StandardsFinding } from '#src/contracts/index.ts';
import type { runStandardsCheck } from '#src/standardsCheck/index.ts';

/**
 * A batch's window onto the live tree, bound to the one scope both its
 * questions must be asked at — see {@link createSiteChecker} for why they
 * travel together.
 */
export interface BatchSiteChecker {
	/** Ask the tree what it currently finds, without persisting a report. */
	checkLive: () => ReturnType<typeof runStandardsCheck>;
	/** Which of the frozen sites the tree still shows. */
	remainingSiteKeys: (params: { frozen: StandardsFinding[] }) => Promise<string[]>;
}
