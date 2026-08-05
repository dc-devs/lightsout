import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RefactorWorklist, type LightsoutConfig, type RunManifest } from '@/contracts';
import type { Driver } from '@/drivers';
import { readGitChangedFiles } from '@/common/git/readGitChangedFiles';
import { createRun } from '@/runState';
import { buildWorklist } from '@/refactor/buildWorklist';

interface Params {
	cwd: string;
	runId: string;
	driver: Driver;
	config: LightsoutConfig;
	path?: string;
	all?: boolean;
	existing?: RunManifest;
}

/**
 * Resolve a refactor run's manifest + frozen worklist. Resume re-reads the
 * frozen file the manifest's `plan` points at (after refusing manifests owned
 * by the implement pipeline). A fresh run enforces the hard requirements — a
 * git worktree and a CLEAN tree, so the ending diff is entirely the run's —
 * then computes the worklist from the tree and freezes it into the run dir.
 */
export const initializeRun = async ({ cwd, runId, driver, config, path, all, existing }: Params): Promise<{ manifest: RunManifest; worklist: RefactorWorklist }> => {
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

	if (dirty.length > 0) {
		throw new Error(`refactor requires a clean tree — commit or stash first. Dirty:\n${dirty.map((file) => `  ${file}`).join('\n')}`);
	}

	const worklist = await buildWorklist({ cwd, config, path, all });
	const worklistPath = join('.lightsout', 'runs', runId, 'worklist.json');
	const manifest = await createRun({ cwd, runId, plan: worklistPath, pipeline: 'refactor', driver: driver.name, config });

	await writeFile(join(cwd, worklistPath), `${JSON.stringify(worklist, undefined, '\t')}\n`, 'utf8');

	return { manifest, worklist };
};
