import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readGitChangedFiles } from '@/common/git/readGitChangedFiles';
import { CoverageWorklist, type LightsoutConfig, type RunManifest } from '@/contracts';
import { runCoverageCheck } from '@/coverage/runCoverageCheck';
import type { Driver } from '@/drivers';
import { createRun } from '@/runState';

interface Params {
	cwd: string;
	runId: string;
	driver: Driver;
	config: LightsoutConfig;
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
 * @throws {Error} When coverage is opted out, the tree is dirty or ungitted, or the run belongs to another pipeline.
 */
export const initializeCoverageRun = async ({
	cwd,
	runId,
	driver,
	config,
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

	if (typeof config.gates.testCoverage !== 'string' && config.packageGates?.testCoverage === undefined) {
		throw new Error('the coverage gate is opted out (gates.testCoverage: false) — test-coverage-to-threshold has nothing to run');
	}

	const dirty = await readGitChangedFiles({ cwd });

	if (dirty === undefined) {
		throw new Error('test-coverage-to-threshold requires a git worktree — without git, changes cannot be attributed or reviewed as one diff.');
	}

	if (dirty.length > 0) {
		throw new Error(`test-coverage-to-threshold requires a clean tree — commit or stash first. Dirty:\n${dirty.map((file) => `  ${file}`).join('\n')}`);
	}

	const measured = await runCoverageCheck({ cwd, config });
	const worklist: CoverageWorklist = { at: new Date().toISOString(), totals: measured.totals, files: measured.files };
	const worklistPath = join('.lightsout', 'runs', runId, 'worklist.json');
	const manifest = await createRun({ cwd, runId, plan: worklistPath, pipeline: 'coverage', driver: driver.name, config });

	await writeFile(join(cwd, worklistPath), `${JSON.stringify(worklist, undefined, '\t')}\n`, 'utf8');

	return { manifest, worklist };
};
