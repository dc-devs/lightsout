import { relative, sep } from 'node:path';
import { formatPlanAddress } from '#src/common/planAddress/formatPlanAddress.ts';
import { parsePlanAddress } from '#src/common/planAddress/parsePlanAddress.ts';
import { workOrdersDir } from '#src/common/workspace/workOrdersDir.ts';
import { resolveRecordedPlanPath } from '#src/plan/common/paths/resolveRecordedPlanPath.ts';

interface Params {
	cwd: string;
	/** The --plan value exactly as the user gave it. */
	planPath: string;
}

/**
 * The plan a `--plan` value names, or undefined when the value does not live in
 * a ticket's plans folder.
 *
 * `planWorkspaceDir` and `planWorkspacePath` build a path from a name; this
 * reads a name back out of one, so the rules that are about a plan's name — the
 * ticket it carries above all — can be asked of a command that takes a path
 * instead. It asks `workOrdersDir` rather than writing the prefix again, and
 * resolves the given value through `resolveRecordedPlanPath` so that a
 * tickets-directory path handed from a linked worktree is rooted where
 * `workOrdersDir` answers: rooting the two differently would relativise every such
 * path to a walk-up and read as no plan at all.
 *
 * A path inside a plan subfolder of a ticket's plans folder answers that plan's
 * address, spelled with `/` whatever the platform's path separator is, because
 * the address is the `--name` value every plan subcommand takes. Every other
 * path inside that plans folder answers the ticket's bare name, which is what a
 * plan shaped before its ticket exists is addressed by.
 *
 * Only `plans/` is a plan's home, so a path under a ticket's `runs/` folder —
 * and the ticket folder itself — answers undefined rather than claiming the
 * ticket's name: a run inside a ticket folder that belongs to no plan must say
 * so, since this answer is what a run manifest records.
 *
 * A path anywhere else answers undefined too: a `--plan` pointing at an
 * arbitrary markdown file is not a plan workspace, and its parent folder's name
 * is nobody's convention to keep.
 */
export const planNameFromPath = async ({ cwd, planPath }: Params): Promise<string | undefined> => {
	const fromTicketsDir = relative(await workOrdersDir({ cwd }), await resolveRecordedPlanPath({ cwd, path: planPath }));
	const [workOrderName, folder, planId] = fromTicketsDir.split(sep);

	// `relative` walks up with `..` segments, and answers an absolute path
	// outright across a Windows drive change — whose first segment is '' here.
	if (workOrderName === undefined || workOrderName === '' || workOrderName === '..' || folder !== 'plans') {
		return undefined;
	}

	const address = planId === undefined ? undefined : formatPlanAddress({ workOrderName, planId });

	return address !== undefined && parsePlanAddress({ name: address }) !== undefined ? address : workOrderName;
};
