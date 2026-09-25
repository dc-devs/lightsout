import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { RefactorWorklist } from '#src/contracts/refactor/RefactorWorklist.ts';
import { PipelineKind } from '#src/contracts/run/PipelineKind.ts';
import type { RunManifest } from '#src/contracts/run/RunManifest.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import { buildWorklist } from '#src/refactor/internal/buildWorklist.ts';
import { resolveNewRunDir } from '#src/runState/common/paths/resolveNewRunDir.ts';
import { resolveRunDir } from '#src/runState/common/paths/resolveRunDir.ts';
import { createRun } from '#src/runState/createRun.ts';

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

		// Read from the run's own directory rather than by joining the recorded
		// path onto `cwd`: run folders resolve against the primary checkout, so a
		// resume standing in a worktree would open a file that is not there.
		const frozen = join(await resolveRunDir({ cwd, runId: existing.runId }), 'worklist.json');

		return { manifest: existing, worklist: RefactorWorklist.parse(JSON.parse(await readFile(frozen, 'utf8'))) };
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
	const worklistPath = join(await resolveNewRunDir({ cwd, pipeline: PipelineKind.Refactor, runId }), 'worklist.json');
	// `createRun` records the path repo-relative and creates the folder, so the
	// write below lands in a directory that exists.
	const manifest = await createRun({ cwd, runId, plan: worklistPath, pipeline: PipelineKind.Refactor, driver: driver.name, config, baselineDirtyFiles: dirty });

	await writeFile(worklistPath, `${JSON.stringify(worklist, undefined, '\t')}\n`, 'utf8');

	return { manifest, worklist };
};
