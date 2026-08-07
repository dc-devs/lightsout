import { RunStatus, type LightsoutConfig, type RunManifest } from '@/contracts';
import type { Driver } from '@/drivers';
import { createRun } from '@/runState';
import { readGitChangedFiles } from '@/common/git/readGitChangedFiles';
import { readGitPrefix } from '@/common/git/readGitPrefix';
import { withRunLock } from '@/runState';
import { PipelineRun } from '@/pipeline/PipelineRun';
import { buildSteps } from '@/pipeline/steps/buildSteps';
import { prepareRun } from '@/pipeline/common/utils/prepareRun';
import { runSteps } from '@/pipeline/common/utils/runSteps';
import type { PipelineResult } from '@/pipeline/PipelineResult';

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
 * Clean-slate gate → implement → verify → write-tests (one writer per source
 * file, in parallel) → verify → refactor (looped until a pass changes
 * nothing) → verify → format. Every state transition is persisted before the
 * next action, so a crash, rate-limit park, or escalation at any point
 * leaves a resumable, truthful record on disk — resume re-enters here and
 * walks past every step already marked passed.
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

	await run.update({ status: RunStatus.Running });

	const stopped = await runSteps({ run, steps });

	if (stopped) {
		return stopped;
	}

	await run.update({ status: RunStatus.Passed, currentStep: null });

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
