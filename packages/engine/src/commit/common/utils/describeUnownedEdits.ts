import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { isGeneratedPath } from '#src/common/sourceFiles/isGeneratedPath.ts';
import type { RunManifest } from '#src/contracts/index.ts';
import { readWorktreeRecord } from '#src/worktree/index.ts';

interface Params {
	/** The checkout the commit would stage. */
	cwd: string;
	manifest: RunManifest;
	/** The run's configured `generated` path prefixes. Build output under one of them is never a stray edit, whoever regenerated it. */
	generated: string[];
}

/**
 * Why the checkout may not be committed in, or undefined when it may.
 *
 * The commit stages through `git add -A`, so in a checkout a person chose
 * themselves anything they edited while the run sat parked would ride into the
 * ticket's pull request. The dirty tree is therefore compared against what the
 * run itself recorded: its own changed files plus the files that were already
 * dirty when it started.
 *
 * Refusing every dirty tree instead would make a parked run unresumable,
 * because a parked run's own partial work is exactly what makes that tree
 * dirty. A tree lightsout cut — for a drain, for an implementation run, for a
 * planning session alike — skips the comparison outright: it was cut for this
 * ticket's own work on this ticket's own branch, and only a tree somebody else
 * chose is the hazard.
 *
 * Generated paths are dropped from the stray set before the verdict. This runs
 * BEFORE `commitWorkOrderWork`, which is the only code that takes build output
 * back out of the tree, so without the exclusion a run whose own gates
 * regenerated a tracked file would be refused over it.
 */
export const describeUnownedEdits = async ({ cwd, manifest, generated }: Params): Promise<string | undefined> => {
	const record = manifest.branch === undefined ? undefined : await readWorktreeRecord({ cwd, branch: manifest.branch });

	if (record !== undefined) {
		return undefined;
	}

	const own = new Set([...manifest.changedFiles, ...manifest.baselineDirtyFiles]);
	const stray = ((await readGitChangedFiles({ cwd })) ?? []).filter((path) => !own.has(path) && !isGeneratedPath({ path, generated }));

	return stray.length === 0
		? undefined
		: `${cwd} holds changes this run did not make: ${stray.join(', ')} — commit or stash them before resuming, or they ride into this ticket's commit`;
};
