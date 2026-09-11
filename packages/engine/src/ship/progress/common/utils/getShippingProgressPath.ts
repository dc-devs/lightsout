import { join } from 'node:path';
import { toBranchFileName } from '#src/common/utils/toBranchFileName.ts';

interface Params {
	cwd: string;
	/** The branch as git names it. */
	branch: string;
}

/**
 * A branch's shipping record: `<repo>/.lightsout/ship/progress/<branch>.json`,
 * in the same ship folder its result is filed in and slugged the same way, so
 * `feature/x` is one flat file rather than a `feature` subdirectory.
 */
export const getShippingProgressPath = ({ cwd, branch }: Params): string => {
	return join(cwd, '.lightsout', 'ship', 'progress', `${toBranchFileName({ branch })}.json`);
};
