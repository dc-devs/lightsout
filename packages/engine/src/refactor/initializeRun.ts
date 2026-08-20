import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { type LightsoutConfig, RefactorWorklist, type RunManifest } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { buildWorklist } from '#src/refactor/buildWorklist.ts';
import { createRun } from '#src/runState/index.ts';

interface Params {
	cwd: string;
	runId: string;
	driver: Driver;
	config: LightsoutConfig;
	path?: string;
	all?: boolean;
	/** Accept a dirty tree: the standing dirt is recorded as baseline, never attributed to a batch. */
	allowDirty?: boolean;
	existing?: RunManifest;
}

/**
 * Resolve a refactor run's manifest + frozen worklist. Resume re-reads the
 * frozen file the manifest's `plan` points at (after refusing manifests owned
 * by the implement pipeline). A fresh run enforces the hard requirements — a
 * git worktree and a CLEAN tree, so the ending diff is entirely the run's —
 * then computes the worklist from the tree and freezes it into the run dir.
 *
 * `allowDirty` trades the clean-tree guarantee for a recorded baseline: the
 * files dirty at start are frozen into the manifest and excluded from batch
 * attribution, so successive runs can stack while commits are frozen. The
 * pre-flight gates still stand — a dirty tree that cannot pass them cannot
 * be refactored either way.
 */
export const initializeRun = async ({
	cwd,
	runId,
	driver,
	config,
	path,
	all,
	allowDirty = false,
	existing,
}: Params): Promise<{ manifest: RunManifest; worklist: RefactorWorklist }> => {
	if (existing) {
		if ((existing.pipeline ?? 'implement') !== 'refactor') {
			throw new Error(`run ${existing.runId} belongs to the implement pipeline — resume it with: lightsout resume --run ${existing.runId}`);
		}

		return { manifest: existing, worklist: RefactorWorklist.parse(JSON.parse(await readFile(join(cwd, existing.plan), 'utf8'))) };
	}

	const dirty = await readGitChangedFiles({ cwd });

	if (dirty === undefined) {
		throw new Error('refactor requires a git worktree — without git, changes cannot be attributed or reviewed as one diff.');
	}

	if (dirty.length > 0 && !allowDirty) {
		throw new Error(
			`refactor requires a clean tree — commit or stash first, or accept the standing changes as baseline with --allow-dirty. Dirty:\n${dirty.map((file) => `  ${file}`).join('\n')}`,
		);
	}

	const worklist = await buildWorklist({ cwd, config, path, all });
	const worklistPath = join('.lightsout', 'runs', runId, 'worklist.json');
	const manifest = await createRun({ cwd, runId, plan: worklistPath, pipeline: 'refactor', driver: driver.name, config, baselineDirtyFiles: dirty });

	await writeFile(join(cwd, worklistPath), `${JSON.stringify(worklist, undefined, '\t')}\n`, 'utf8');

	return { manifest, worklist };
};
