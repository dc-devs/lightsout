import { relative, resolve, sep } from 'node:path';
import { formatPlanAddress } from '#src/common/planAddress/formatPlanAddress.ts';
import { parsePlanAddress } from '#src/common/planAddress/parsePlanAddress.ts';
import { plansDir } from '#src/plan/plansDir.ts';

interface Params {
	cwd: string;
	/** The --plan value exactly as the user gave it. */
	planPath: string;
}

/**
 * The plan a `--plan` value names, or undefined when the value does not live in
 * the repo's plans directory.
 *
 * `planWorkspaceDir` and `planWorkspacePath` build a path from a name; this
 * reads a name back out of one, so the rules that are about a plan's name — the
 * ticket it carries above all — can be asked of a command that takes a path
 * instead. It asks `plansDir` rather than writing the prefix again.
 *
 * A path inside a plan subfolder of a ticket folder answers that plan's address,
 * spelled with `/` whatever the platform's path separator is, because the
 * address is the `--name` value every plan subcommand takes. Every other path
 * inside the plans directory answers its first segment, exactly as before: a
 * legacy folder named for its branch alone, and a folder whose subfolder is
 * `implemented/` rather than a plan, both belong to that one name.
 *
 * A path anywhere else answers undefined, including the plans directory itself:
 * a `--plan` pointing at an arbitrary markdown file is not a plan workspace,
 * and its parent folder's name is nobody's convention to keep.
 */
export const planNameFromPath = ({ cwd, planPath }: Params): string | undefined => {
	const fromPlansDir = relative(plansDir({ cwd }), resolve(cwd, planPath));
	const [ticketBranch, planId] = fromPlansDir.split(sep);

	// `relative` walks up with `..` segments, and answers an absolute path
	// outright across a Windows drive change — whose first segment is '' here.
	if (fromPlansDir === '' || ticketBranch === undefined || ticketBranch === '' || ticketBranch === '..') {
		return undefined;
	}

	const address = planId === undefined ? undefined : formatPlanAddress({ ticketBranch, planId });

	return address !== undefined && parsePlanAddress({ name: address }) !== undefined ? address : ticketBranch;
};
