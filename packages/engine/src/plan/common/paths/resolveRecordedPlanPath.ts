import { join, resolve } from 'node:path';
import { workOrdersDir } from '#src/common/workspace/workOrdersDir.ts';

interface Params {
	/** The checkout the reader is working in — a primary checkout, a linked worktree, or no repository. */
	cwd: string;
	/** A plan path as run state recorded it: repo-relative with forward slashes by contract, or absolute from an older record. */
	path: string;
}

/**
 * Which file on disk a recorded plan path names.
 *
 * Every other repo-relative path a run records is read under the checkout the
 * run works in, but a plan folder now lives in the primary checkout whichever
 * checkout is working — so a recorded tickets-directory path read against a
 * worktree names a file that is not there, silently, as a plan that "does not
 * exist". One answer for the three readers of such a path, rather than the same
 * rule grown three times.
 *
 * An absolute path is answered unchanged: it already names a file. A path under
 * the pre-layout plans folder, and the legacy `.claude/plans/` prefix, both stay
 * with the given checkout on purpose — a manifest carrying either was written
 * before plan data moved and its folder was never relocated.
 */
export const resolveRecordedPlanPath = async ({ cwd, path }: Params): Promise<string> => {
	// Both separators, because the contract spells a recorded path with forward
	// slashes while a `--plan` value carries whatever the user's shell gave it.
	const [stateDir, workOrdersFolder, ...tail] = path.split(/[/\\]/);

	if (stateDir !== '.lightsout' || workOrdersFolder !== 'work-orders' || tail.length === 0) {
		return resolve(cwd, path);
	}

	return join(await workOrdersDir({ cwd }), ...tail);
};
