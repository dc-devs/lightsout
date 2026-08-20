import { defaultPackagesDir } from '#src/common/constants/defaultPackagesDir.ts';
import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { readGitPrefix } from '#src/common/git/readGitPrefix.ts';
import { listSourceFiles } from '#src/common/utils/listSourceFiles.ts';
import { resolveConsumerTypescript } from '#src/common/utils/resolveConsumerTypescript.ts';
import { type LightsoutConfig, type RunManifest, RunStatus } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { prepareRun } from '#src/pipeline/common/utils/prepareRun.ts';
import { resolveTestSubjects } from '#src/pipeline/common/utils/resolveTestSubjects.ts';
import { runSteps } from '#src/pipeline/common/utils/runSteps.ts';
import type { PipelineResult } from '#src/pipeline/PipelineResult.ts';
import { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { buildSteps } from '#src/pipeline/steps/buildSteps.ts';
import { createRun, withRunLock } from '#src/runState/index.ts';

// The end-of-run look at the files write-tests skipped as unreachable: later
// steps (refactor wiring) may have connected them to a public surface, so
// each is re-resolved before the run finishes — files now reached (or gone
// from the tree) drop off, and anything still orphaned stays in the manifest
// under a named warning. A wiring defect is surfaced, never hidden.
const recheckUnreachable = async ({ run }: { run: PipelineRun }) => {
	const recorded = run.current().unreachableChangedFiles;

	if (recorded.length === 0) {
		return;
	}

	const packagesDir = run.config['packages-dir'] ?? defaultPackagesDir;
	const compiler = resolveConsumerTypescript({ cwd: run.cwd, packagesDir });
	const universe = (await listSourceFiles({ cwd: run.cwd, exclude: run.config.generated })).files;
	const targets = recorded.filter((file) => universe.includes(file));
	const { orphans } = await resolveTestSubjects({ cwd: run.cwd, targets, universe, packagesDir, compiler });

	await run.update({ patch: { unreachableChangedFiles: orphans } });

	if (orphans.length > 0) {
		run.progress(
			`warning unreachable-changed-files: ${orphans.length} changed file(s) finished the run with no public surface reaching them: ${orphans.join(', ')} — wire them into a barrel-exported surface (or delete them) in follow-up work; no tests cover them.`,
		);
	}
};

interface Params {
	cwd: string;
	driver: Driver;
	config: LightsoutConfig;
	/** Plan path for a fresh run. Ignored when resuming (the manifest owns it). */
	planPath?: string;
	/** Optional overview plan path (high-level context for a phased plan). Ignored when resuming. */
	overviewPath?: string;
	/** Package scope override (monorepo mode). Falls back to the plan front-matter `packages:` list. */
	packages?: string[];
	/** Resume: an existing manifest — steps already passed are skipped. */
	existing?: RunManifest;
	skipRefactor?: boolean;
	/** Live progress sink (steps, gate results, agent reports). Silent when omitted. */
	onProgress?: (message: string) => void;
}

/**
 * The pipeline body — always entered holding the run lock (the exported
 * wrapper below acquires and releases it around this).
 *
 * Clean-slate gate → implement → verify → write-tests (one writer per group
 * of public subjects, in parallel) → verify → refactor (looped until a pass
 * changes nothing) → verify → format. Every state transition is persisted
 * before the next action, so a crash, rate-limit park, or escalation at any
 * point leaves a resumable, truthful record on disk — resume re-enters here
 * and walks past every step already marked passed.
 *
 * Changed files flow step to step through the manifest: each agent's typed
 * report is merged with a git snapshot (minus the run's baseline dirt), and
 * the merged list feeds the next role's invocation.
 */
const executePipeline = async ({
	cwd,
	runId,
	driver,
	config,
	planPath,
	overviewPath,
	packages,
	existing,
	skipRefactor,
	onProgress,
}: Params & { runId: string }): Promise<PipelineResult> => {
	const run = new PipelineRun({
		cwd,
		config,
		driver,
		onProgress,
		manifest:
			existing ??
			(await createRun({
				cwd,
				runId,
				plan: planPath ?? '',
				pipeline: 'implement',
				overview: overviewPath,
				driver: driver.name,
				config,
				baselineDirtyFiles: await readGitChangedFiles({ cwd }),
			})),
	});
	const prepared = await prepareRun({ run, cwd, config, packages });

	if ('error' in prepared) {
		return run.stop({
			record: { id: 'clean-slate', status: RunStatus.Running, attempts: 0 },
			status: RunStatus.Failed,
			error: prepared.error,
		});
	}

	const { planContent, overviewContent, standards, testStandards } = prepared;

	// Agents in a consumer nested inside a larger git repo sometimes echo
	// repo-ROOT-relative paths — computed once, threaded into every derivation
	// that normalizes report paths.
	const gitPrefix = await readGitPrefix({ cwd });
	const steps = buildSteps({ run, gitPrefix, planContent, overviewContent, standards, testStandards, skipRefactor });

	await run.update({ patch: { status: RunStatus.Running } });

	const stopped = await runSteps({ run, steps });

	if (stopped) {
		return stopped;
	}

	await recheckUnreachable({ run });
	await run.update({ patch: { status: RunStatus.Passed, currentStep: null } });

	const passed: PipelineResult = { ok: true, manifest: run.current() };

	return passed;
};

/**
 * Public entry: the shared run-lock lifecycle around the pipeline body —
 * acquisition happens before ANY disk write, every exit path releases, and
 * the refactor pipeline takes the same repo lock, so the two can never race
 * one tree.
 */
export const runImplementPipeline = (params: Params): Promise<PipelineResult> => withRunLock({ params, run: executePipeline });
