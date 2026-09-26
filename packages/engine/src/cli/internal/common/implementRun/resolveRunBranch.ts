import { workOrderNameOf } from '#src/common/planAddress/workOrderNameOf.ts';
import { readWorkOrderRecordFile } from '#src/common/workspace/readWorkOrderRecordFile.ts';
import { workOrderFolderDir } from '#src/common/workspace/workOrderFolderDir.ts';
import { planNameFromPath } from '#src/plan/planNameFromPath.ts';
import { findWorkOrderByTicketRef } from '#src/workOrder/findWorkOrderByTicketRef.ts';

interface Params {
	/** The checkout the command was launched from. */
	cwd: string;
	/** `--plan` exactly as the user typed it, for a plan-based run. */
	planPath?: string;
	/** `--ticket` exactly as the user typed it — named in the refusal, never turned into a branch. */
	ticketPath?: string;
	/** `--ref` exactly as the user typed it, when a direct run named one. */
	ticketRef?: string;
}

/** The branch stored by the work order a plan address names, or undefined when no record answers to that label. */
const branchOfPlan = async ({ cwd, planPath }: { cwd: string; planPath: string }) => {
	const planName = await planNameFromPath({ cwd, planPath });

	if (planName === undefined) {
		return undefined;
	}

	const record = await readWorkOrderRecordFile({ workOrderFolder: await workOrderFolderDir({ cwd, name: workOrderNameOf({ name: planName }) }) });

	return record?.branch;
};

/**
 * The branch an isolated run is put on: the one the work order's record stores,
 * or the one sentence saying the input names no work order.
 *
 * Nothing is derived here any more. A plan address names a work order and the
 * record says which branch its plans implement on; a `--ref` names a ticket and
 * the work order carrying it says the same. Deriving a branch from a file stem
 * or re-rendering the queue's template would put a second author of the branch
 * back in, and a second author is exactly what a work order's record exists to
 * remove.
 *
 * That is a real narrowing for `implement-direct`: an isolated direct run needs
 * a `--ref` whose work order exists, and everything else builds in the
 * launching checkout. Its one caller is `resolveRunWorkspace`, which calls it
 * only once isolation is decided, so a run building where it was launched is
 * never refused for failing to name a work order.
 */
export const resolveRunBranch = async ({ cwd, planPath, ticketPath, ticketRef }: Params): Promise<string | { error: string }> => {
	let branch: string | undefined;

	if (planPath !== undefined) {
		branch = await branchOfPlan({ cwd, planPath });
	} else if (ticketRef !== undefined) {
		branch = (await findWorkOrderByTicketRef({ cwd, ticketRef }))?.record.branch;
	}

	const named = planPath ?? ticketPath ?? ticketRef ?? '--ref';

	return branch === undefined
		? {
				error: `no branch could be resolved from '${named}' — it names no work order, and only a work order's record says which branch its work implements on, so pass --no-worktree to build in the checkout this was launched from`,
			}
		: branch;
};
