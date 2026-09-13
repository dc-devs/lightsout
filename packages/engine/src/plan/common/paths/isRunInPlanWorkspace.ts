import { planWorkspacePath } from '#src/plan/planWorkspacePath.ts';

interface Params {
	/** A run manifest's `plan` path, repo-relative with forward slashes. */
	runPlan: string;
	/** The plan folder's name under the plans directory: a legacy folder name, or a plan address. */
	name: string;
}

/**
 * Whether a run built something inside this plan folder.
 *
 * Prefix rather than exact match: a phased plan's runs each name a different
 * phase file and its coordinator names `overview.md`, so an exact match would
 * see one run out of thirteen. The trailing slash is what keeps `lo-7` from
 * claiming `lo-70`'s runs. The legacy `.claude/plans/` prefix is matched too —
 * manifests on disk still carry it.
 *
 * One home for the rule, because the views match a plan's runs by it and
 * adoption decides how far a folder's implementation got by it.
 */
export const isRunInPlanWorkspace = ({ runPlan, name }: Params): boolean =>
	runPlan.startsWith(`${planWorkspacePath({ name })}/`) || runPlan.startsWith(`.claude/plans/${name}/`);
