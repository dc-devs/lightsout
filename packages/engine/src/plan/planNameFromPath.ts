import { relative, resolve, sep } from 'node:path';
import { plansDir } from '#src/plan/plansDir.ts';

interface Params {
	cwd: string;
	/** The --plan value exactly as the user gave it. */
	planPath: string;
}

/**
 * The plan folder a `--plan` value names, or undefined when the value does not
 * live in the repo's plans directory.
 *
 * `planWorkspaceDir` and `planWorkspacePath` build a path from a name; this
 * reads a name back out of one, so the rules that are about a plan folder's
 * name — the ticket it carries above all — can be asked of a command that takes
 * a path instead. It asks `plansDir` rather than writing the prefix again.
 *
 * A path anywhere else answers undefined, including the plans directory itself:
 * a `--plan` pointing at an arbitrary markdown file is not a plan workspace,
 * and its parent folder's name is nobody's convention to keep.
 */
export const planNameFromPath = ({ cwd, planPath }: Params): string | undefined => {
	const fromPlansDir = relative(plansDir({ cwd }), resolve(cwd, planPath));
	const [name] = fromPlansDir.split(sep);

	// `relative` walks up with `..` segments, and answers an absolute path
	// outright across a Windows drive change — whose first segment is '' here.
	return fromPlansDir === '' || name === '' || name === '..' ? undefined : name;
};
