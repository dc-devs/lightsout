import { join } from 'node:path';
import { toBranchFileName } from '#src/common/utils/toBranchFileName.ts';
import { workOrderFolderDir } from '#src/common/workspace/workOrderFolderDir.ts';

interface Params {
	/** Any checkout of the repository; the primary is resolved from it. */
	cwd: string;
	/** The branch the result describes, or the literal `unknown` when git could not name one. */
	branch: string;
}

/**
 * A branch's ship result: `ship.json` in that branch's ticket folder, beside
 * the shipping record the same ship wrote.
 *
 * The branch is slugged rather than used as written. A ticket branch carries
 * only letters, digits and hyphens, so it slugs to itself and the result lands
 * in that ticket's own folder — while the queue's branch template is free to
 * carry slashes, and one used as written would make a nested directory rather
 * than that branch's own folder.
 */
export const getShipResultPath = async ({ cwd, branch }: Params): Promise<string> => {
	return join(await workOrderFolderDir({ cwd, name: toBranchFileName({ branch }) }), 'ship.json');
};
