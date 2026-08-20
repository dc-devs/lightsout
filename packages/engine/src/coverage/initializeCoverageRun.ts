import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { CoverageWorklist, type LightsoutConfig, type RunManifest } from '#src/contracts/index.ts';
import { runCoverageCheck } from '#src/coverage/runCoverageCheck.ts';
import type { Driver } from '#src/drivers/index.ts';
import { createRun } from '#src/runState/index.ts';

interface Params {
	cwd: string;
	runId: string;
	driver: Driver;
	config: LightsoutConfig;
	/** Accept a dirty tree: the standing dirt is recorded as baseline, never attributed to a batch. */
	allowDirty?: boolean;
	existing?: RunManifest;
}

/**
 * Resolve a coverage run's manifest + frozen initial measurement. Resume
 * re-reads the frozen file the manifest's `plan` points at (after refusing
 * manifests another pipeline owns). A fresh run refuses a config that opted
 * out of the coverage gate, enforces a git worktree and a CLEAN tree — so the
 * ending diff is entirely the run's — then measures once and freezes the
 * result as the `before` side of the final report.
 *
 * `allowDirty` trades the clean-tree guarantee for a recorded baseline, the
 * same bargain the refactor pipeline offers: the files dirty at start are
 * frozen into the manifest and excluded from batch attribution, so runs can
 * stack while commits are frozen.
 *
 * @throws {Error} When coverage is opted out, the tree is dirty (and not accepted) or ungitted, or the run belongs to another pipeline.
 */
export const initializeCoverageRun = async ({
	cwd,
	runId,
	driver,
	config,
	allowDirty = false,
	existing,
}: Params): Promise<{ manifest: RunManifest; worklist: CoverageWorklist }> => {
	if (existing) {
		const pipeline = existing.pipeline ?? 'implement';

		if (pipeline !== 'coverage') {
			const command = pipeline === 'refactor' ? 'refactor' : 'resume';

			throw new Error(`run ${existing.runId} belongs to the ${pipeline} pipeline — resume it with: lightsout ${command} --run ${existing.runId}`);
		}

		return { manifest: existing, worklist: CoverageWorklist.parse(JSON.parse(await readFile(join(cwd, existing.plan), 'utf8'))) };
	}

	if (typeof config.gates['test-coverage'] !== 'string' && config['package-gates']?.['test-coverage'] === undefined) {
		throw new Error('the coverage gate is opted out ("test-coverage": false) — test-coverage-to-threshold has nothing to run');
	}

	const dirty = await readGitChangedFiles({ cwd });

	if (dirty === undefined) {
		throw new Error('test-coverage-to-threshold requires a git worktree — without git, changes cannot be attributed or reviewed as one diff.');
	}

	if (dirty.length > 0 && !allowDirty) {
		throw new Error(
			`test-coverage-to-threshold requires a clean tree — commit or stash first, or accept the standing changes as baseline with --allow-dirty. Dirty:\n${dirty.map((file) => `  ${file}`).join('\n')}`,
		);
	}

	const measured = await runCoverageCheck({ cwd, config });
	const worklist: CoverageWorklist = { at: new Date().toISOString(), totals: measured.totals, files: measured.files };
	const worklistPath = join('.lightsout', 'runs', runId, 'worklist.json');
	const manifest = await createRun({ cwd, runId, plan: worklistPath, pipeline: 'coverage', driver: driver.name, config, baselineDirtyFiles: dirty });

	await writeFile(join(cwd, worklistPath), `${JSON.stringify(worklist, undefined, '\t')}\n`, 'utf8');

	return { manifest, worklist };
};
