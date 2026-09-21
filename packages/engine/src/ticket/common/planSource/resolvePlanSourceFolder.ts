import { dirname } from 'node:path';
import { parsePlanAddress } from '#src/common/planAddress/parsePlanAddress.ts';
import { resolveSharedStateDir } from '#src/common/workspace/resolveSharedStateDir.ts';
import { RunStatus } from '#src/contracts/index.ts';
import { planWorkspaceDir, resolvePlanDeliverable } from '#src/plan/index.ts';
import { findLiveRunRefusal } from '#src/ticket/common/planSource/findLiveRunRefusal.ts';
import { readLooseFileProgress } from '#src/ticket/common/planSource/readLooseFileProgress.ts';
import { readLooseFileRuns } from '#src/ticket/common/planSource/readLooseFileRuns.ts';
import type { PlanSourceFolder } from '#src/ticket/common/types/PlanSourceFolder.ts';
import { listLoosePlanEntries } from '#src/ticket/common/utils/listLoosePlanEntries.ts';

interface Params {
	/** Any checkout of the repository: the folder a plan is made out of is always the PRIMARY checkout's. */
	cwd: string;
	/** The `--from` value exactly as it was typed. */
	from: string;
}

/** Whether the value names a folder at all, since `--from` may never reach outside the plans directory. */
const findSourceNameRefusal = ({ from }: { from: string }) => {
	if (parsePlanAddress({ name: from }) !== undefined) {
		return `--from names the folder a plan is made out of, and '${from}' is a plan's own address — name the folder holding the loose files instead`;
	}

	const bare = from !== '' && from !== '.' && from !== '..' && !from.includes('/') && !from.includes('\\');

	return bare ? undefined : `--from takes a plan folder's bare name under the plans directory, and '${from}' is not one — a path is never one of them`;
};

/**
 * Everything a `--from` add is decided from, gathered before the record is
 * changed, or the one sentence saying why it may not proceed.
 *
 * Every refusal is settled here, in one order: the value's own shape, the
 * source's plans folder, its loose files, its own top-level runs, a run of it
 * that is still live, and only then how far it got. Nothing is written, so a
 * refusal leaves the folder exactly as it was found. The primary checkout is
 * resolved here and stays here: nothing outside this file reads the source's
 * own runs or its deliverable.
 */
export const resolvePlanSourceFolder = async ({ cwd, from }: Params): Promise<PlanSourceFolder | { error: string }> => {
	const named = findSourceNameRefusal({ from });

	if (named !== undefined) {
		return { error: named };
	}

	const primaryCheckout = dirname(await resolveSharedStateDir({ cwd }));
	const plansFolder = await planWorkspaceDir({ cwd, name: from });
	const entries = await listLoosePlanEntries({ plansFolder });

	if (entries.length === 0) {
		// A folder that is not on disk and one holding no loose files are the same
		// answer: `--from` names a folder on this machine, and restoring a plan's
		// files from its ticket is `restoreTicketPlan`'s job rather than this one's.
		return { error: `the plan folder '${from}' holds no loose files at ${plansFolder}, so there is nothing here to make a plan out of` };
	}

	const runs = await readLooseFileRuns({ primaryCheckout, planName: from });
	const live = await findLiveRunRefusal({ primaryCheckout, runs });

	if (live !== undefined) {
		return { error: live };
	}

	const hasDeliverable = (await resolvePlanDeliverable({ cwd: primaryCheckout, name: from })).error === undefined;

	return {
		plansFolder,
		entries,
		progress: readLooseFileProgress({ runs, hasDeliverable }),
		hasDeliverable,
		hasUnfinishedRun: runs.some((manifest) => manifest.status !== RunStatus.Passed),
	};
};
