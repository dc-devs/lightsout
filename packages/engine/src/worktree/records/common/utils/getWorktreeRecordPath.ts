import { join } from 'node:path';
import { toBranchFileName } from '#src/common/utils/toBranchFileName.ts';

interface Params {
	/** The `.lightsout` directory of the PRIMARY checkout, resolved by the caller. */
	stateDir: string;
	branch: string;
}

/**
 * Every ownership record gathers in one place:
 * `<stateDir>/worktrees/<branch>.json`.
 *
 * It takes the already-resolved state directory rather than a `cwd` because
 * each record function resolves the primary checkout itself — which is what
 * makes "the record lives in the primary checkout" true by construction rather
 * than by every caller remembering.
 */
export const getWorktreeRecordPath = ({ stateDir, branch }: Params): string => {
	return join(stateDir, 'worktrees', `${toBranchFileName({ branch })}.json`);
};
