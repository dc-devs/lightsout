import type { StandardsFinding } from '#src/contracts/index.ts';
import type { BatchSiteChecker } from '#src/refactor/batch/common/types/BatchSiteChecker.ts';
import { matchRemainingFindings } from '#src/refactor/batch/matchRemainingFindings.ts';
import { runStandardsCheck } from '#src/standardsCheck/index.ts';

interface Params {
	cwd: string;
	/** Check scope of the run's worklist. */
	checkPath?: string;
	/** Include baselined findings — must match the worklist's mode. */
	checkAll: boolean;
}

/**
 * A batch's window onto the live tree: what the checks currently find, and
 * which of a frozen set of sites are still standing.
 *
 * The two are bound together because they must ask the same question. A
 * re-check run at a different scope, or with baselined findings counted
 * differently from the worklist that froze the sites, answers about a tree the
 * batch was never working on — and a site that simply fell outside the scope
 * reads as a site the batch resolved.
 */
export const createSiteChecker = ({ cwd, checkPath, checkAll }: Params): BatchSiteChecker => {
	const checkLive = () => runStandardsCheck({ cwd, path: checkPath, all: checkAll, persist: false });

	const remainingSiteKeys = async ({ frozen }: { frozen: StandardsFinding[] }) => {
		const { findings } = await checkLive();

		return matchRemainingFindings({ frozen, live: findings });
	};

	return { checkLive, remainingSiteKeys };
};
