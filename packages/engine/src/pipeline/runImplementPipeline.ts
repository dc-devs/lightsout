import type { ActivityLevel } from '#src/activity/common/types/ActivityLevel.ts';
import { commitRunWork } from '#src/commit/commitRunWork.ts';
import { defaultPackagesDir } from '#src/common/constants/defaultPackagesDir.ts';
import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { readGitPrefix } from '#src/common/git/readGitPrefix.ts';
import { excludedSourcePaths } from '#src/common/sourceFiles/excludedSourcePaths.ts';
import { listSourceFiles } from '#src/common/sourceFiles/listSourceFiles.ts';
import { resolveConsumerTypescript } from '#src/common/workspace/resolveConsumerTypescript.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { PipelineKind } from '#src/contracts/run/PipelineKind.ts';
import type { RunManifest } from '#src/contracts/run/RunManifest.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import { removeApprovedTests } from '#src/pipeline/approvedTests/removeApprovedTests.ts';
import { prepareRun } from '#src/pipeline/common/utils/prepareRun.ts';
import { resolveTestSubjects } from '#src/pipeline/common/utils/resolveTestSubjects.ts';
import { runSteps } from '#src/pipeline/common/utils/runSteps.ts';
import type { PipelineResult } from '#src/pipeline/PipelineResult.ts';
import { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { buildSteps } from '#src/pipeline/steps/buildSteps/buildSteps.ts';
import { createRun } from '#src/runState/createRun.ts';
import { withRunLock } from '#src/runState/lock/withRunLock.ts';

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
	const universe = (await listSourceFiles({ cwd: run.cwd, exclude: excludedSourcePaths({ config: run.config }) })).files;
	const targets = recorded.filter((file) => universe.includes(file));
	const { orphans } = await resolveTestSubjects({ cwd: run.cwd, targets, universe, packagesDir, compiler });

	await run.update({ patch: { unreachableChangedFiles: orphans } });

	if (orphans.length > 0) {
		run.progress(
			`warning unreachable-changed-files: ${orphans.length} changed file(s) finished the run with no public surface reaching them: ${orphans.join(', ')} — they sit in an internal/ folder that no public file imports, so import them from one (or delete them) in follow-up work; no tests cover them.`,
		);
	}
};

/**
 * How a run whose every step passed ends: the unreachable re-check, the commit,
 * and the stamp or the stop that follows.
 *
 * The commit's position is the whole of it. It runs before the approved copies
 * are removed, because those copies are the baseline a resume diffs against and
 * a refused commit has to leave them on disk — and before the passed stamp,
 * because a run already stamped passed could not be failed by the commit that
 * follows it. Every declared step is recorded passed by now, so the resume a
 * refusal asks for walks straight past all of them and costs only the commit.
 */
const finishRun = async ({ run, resumed }: { run: PipelineRun; resumed: boolean }): Promise<PipelineResult> => {
	await recheckUnreachable({ run });

	const uncommitted = await commitRunWork({ run, driver: run.driver, resumed });
	let result: PipelineResult;

	if (uncommitted === undefined) {
		// Every step passed, so the approved copies have no reader left. A failed,
		// parked or escalated run never reaches here and keeps them.
		await removeApprovedTests({ run });
		await run.update({ patch: { status: RunStatus.Passed, currentStep: null } });

		result = { ok: true, manifest: run.current() };
	} else {
		await run.update({ patch: { status: RunStatus.Failed } });

		result = { ok: false, manifest: run.current(), error: uncommitted };
	}

	return result;
};

interface Params {
	cwd: string;
	driver: Driver;
	config: LightsoutConfig;
	/** The id a fresh run is created under, minted by the caller so the run can be named before it starts. Ignored when resuming. */
	runId?: string;
	/** Plan path for a fresh run. Ignored when resuming (the manifest owns it). */
	planPath?: string;
	/** Optional overview plan path (high-level context for a phased plan). Ignored when resuming. */
	overviewPath?: string;
	/** The coordinator's run id when this run is one phase of a sequence. Ignored when resuming — the existing manifest already carries it. */
	parentRunId?: string;
	/** Package scope override (monorepo mode). Falls back to the plan front-matter `packages:` list. */
	packages?: string[];
	/** Resume: an existing manifest — steps already passed are skipped. */
	existing?: RunManifest;
	/** What the sequence this run is a phase of already owns — supplied only when that sequence was resumed and this phase had not started, so there is no child manifest to adopt. It seeds the run's baseline in place of a fresh git snapshot. */
	inheritedBaseline?: string[];
	skipRefactor?: boolean;
	/** The level this run's agent calls open their own step levels under. Absent wherever no run is being recorded — a phase run is handed its phase's pass level, a single run its command run's. */
	level?: ActivityLevel;
	/** Resolved before the run starts: a passing run will ship this branch. Recorded on the manifest so the progress view can show a ship row. Ignored when resuming — the existing manifest already carries it. */
	willShip?: boolean;
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
	parentRunId,
	packages,
	existing,
	inheritedBaseline,
	skipRefactor,
	level,
	willShip,
	onProgress,
}: Params & { runId: string }): Promise<PipelineResult> => {
	const run = new PipelineRun({
		cwd,
		config,
		driver,
		level,
		onProgress,
		manifest:
			existing ??
			(await createRun({
				cwd,
				runId,
				plan: planPath ?? '',
				pipeline: PipelineKind.Implement,
				overview: overviewPath,
				parentRunId,
				driver: driver.name,
				config,
				baselineDirtyFiles: inheritedBaseline ?? (await readGitChangedFiles({ cwd })),
				willShip,
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

	// The one moment the exact sequence is known — buildSteps has already
	// resolved it, --skip-refactor included — so it is the one moment a reader
	// can be told which steps are still to come.
	await run.update({ patch: { status: RunStatus.Running, stepOrder: steps.map((step) => step.id) } });

	const stopped = await runSteps({ run, steps });

	if (stopped) {
		return stopped;
	}

	return finishRun({ run, resumed: inheritedBaseline !== undefined || existing !== undefined });
};

/**
 * Public entry: the shared run-lock lifecycle around the pipeline body —
 * acquisition happens before ANY disk write, every exit path releases, and
 * the refactor pipeline takes the same repo lock, so the two can never race
 * one tree.
 */
export const runImplementPipeline = (params: Params): Promise<PipelineResult> => withRunLock({ params, run: executePipeline });
