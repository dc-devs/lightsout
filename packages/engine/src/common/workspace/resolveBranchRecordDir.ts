import { findWorkOrderForBranch } from '#src/common/workspace/findWorkOrderForBranch.ts';
import { workOrderFolderDir } from '#src/common/workspace/workOrderFolderDir.ts';

interface Params {
	/** Any checkout of the repository; the primary is resolved from it. */
	cwd: string;
	/** The branch as git names it. */
	branch: string;
}

/**
 * The folder a branch's four machine-local records are filed in: the work
 * order's own folder, beside the plans that branch implements.
 *
 * Undefined is a real answer rather than a failure. The work-orders directory
 * holds work orders, and a folder invented for a branch nothing claims would be
 * a phantom work order — the exact thing slugging a branch into a file name
 * used to create. Every caller reads undefined as "this branch keeps no local
 * record".
 */
export const resolveBranchRecordDir = async ({ cwd, branch }: Params): Promise<string | undefined> => {
	const listing = await findWorkOrderForBranch({ cwd, branch });

	return listing === undefined ? undefined : workOrderFolderDir({ cwd, name: listing.name });
};
