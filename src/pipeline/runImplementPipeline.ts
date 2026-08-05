import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PackagesSource, RunStatus, type LightsoutConfig, type RunManifest } from '@/contracts';
import type { Driver } from '@/drivers';
import { createRun } from '@/runState';
import { readGitChangedFiles } from '@/common/git/readGitChangedFiles';
import { readGitPrefix } from '@/common/git/readGitPrefix';
import { readPlanPackages } from '@/pipeline/readPlanPackages';
import { detectStandardsChannels } from '@/standards';
import { readStandards } from '@/standards';
import { withRunLock } from '@/runState';
import { PipelineRun } from '@/pipeline/PipelineRun';
import type { PipelineStep } from '@/pipeline/PipelineStep';
import { buildSteps } from '@/pipeline/steps/buildSteps';
import { scanPlanPackagePaths } from '@/pipeline/scanPlanPackagePaths';
import type { PipelineResult } from '@/pipeline/PipelineResult';

const testWriterConcurrency = 5;
/** Pathological guard: an import component above this splits into sorted chunks — no config knob until live evidence asks for one. */
const maxWriterGroupFiles = 12;
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
	const progress = (message: string) => run.progress(message);
	const setStep = run.setStep.bind(run);
	const stop = run.stop.bind(run);
	const nextRecord = run.nextRecord.bind(run);
	const update = run.update.bind(run);
	const parkMessage = () => run.parkMessage();

	const planContent = await readFile(join(cwd, run.current().plan), 'utf8').catch(() => undefined);

	if (planContent === undefined) {
		return stop({
			record: { id: 'clean-slate', status: RunStatus.Running, attempts: 0 },
			status: RunStatus.Failed,
			error: `plan file not found: ${join(cwd, run.current().plan)}`,
		});
	}

	const overviewContent = run.current().overview
		? await readFile(join(cwd, run.current().overview ?? ''), 'utf8').catch(() => undefined)
		: undefined;

	if (run.current().overview && overviewContent === undefined) {
		return stop({
			record: { id: 'clean-slate', status: RunStatus.Running, attempts: 0 },
			status: RunStatus.Failed,
			error: `overview file not found: ${join(cwd, run.current().overview ?? '')}`,
		});
	}

	const packagesDir = config.packagesDir ?? 'packages';

	// Monorepo mode needs a scope before any gate runs. The chain: --packages
	// flag → plan front-matter → concrete package paths in the plan body (safe
	// fallback: over-inclusion only runs extra gates, under-inclusion is
	// caught by scope expansion) → hard error. Never inference beyond that.
	if (config.packageScripts && run.current().packages.length === 0) {
		const fromFlag = packages;
		const fromFrontMatter = fromFlag ? undefined : readPlanPackages({ planContent });
		const fromPlanPaths = (fromFlag ?? fromFrontMatter) ? undefined : scanPlanPackagePaths({ planContent, packagesDir });
		const declared = fromFlag ?? fromFrontMatter ?? fromPlanPaths;

		if (!declared || declared.length === 0) {
			return stop({
				record: { id: 'clean-slate', status: RunStatus.Running, attempts: 0 },
				status: RunStatus.Failed,
				error: `packageScripts is configured but no package scope could be resolved — add a \`packages:\` list to the plan front-matter, pass --packages <a,b>, or reference concrete ${packagesDir}/<name>/ paths in the plan.`,
			});
		}

		await update({
			packages: declared,
			packagesSource: fromFlag ? PackagesSource.Flag : fromFrontMatter ? PackagesSource.FrontMatter : PackagesSource.PlanPaths,
		});
	}

	if (run.current().packages.length > 0) {
		progress(`package scope: ${run.current().packages.join(', ')} (from ${run.current().packagesSource ?? 'manifest'})`);
	}

	// Standards resolve AFTER scope: the bundled defaults are channelled —
	// base docs always, framework docs (react, tanstack) only when the scoped
	// packages' dependencies say the framework is in play, so a backend run
	// never pays the React-docs token tax. Config `standardsChannels`
	// replaces detection. Unspecified standards = the bundled defaults
	// (announced, never silent); `false` = explicitly none; an array =
	// exactly what it says.
	const standardsPaths = config.standards === false ? [] : (config.standards ?? ['lightsout:code-defaults']);
	const testStandardsPaths = config.testStandards === false ? [] : (config.testStandards ?? ['lightsout:test-defaults']);
	const channels =
		config.standardsChannels ?? (await detectStandardsChannels({ cwd, packagesDir, packages: run.current().packages }));

	if (standardsPaths.length > 0 || testStandardsPaths.length > 0) {
		progress(
			`standards channels: base${channels.length > 0 ? ` + ${channels.join(' + ')}` : ''} (${config.standardsChannels ? 'configured' : 'detected from package dependencies'})`,
		);
	}

	let standards: string | undefined;
	let testStandards: string | undefined;

	try {
		standards = await readStandards({ cwd, paths: standardsPaths, channels });
		testStandards = await readStandards({ cwd, paths: testStandardsPaths, channels });
	} catch (error) {
		return stop({
			record: { id: 'clean-slate', status: RunStatus.Running, attempts: 0 },
			status: RunStatus.Failed,
			error: error instanceof Error ? error.message : String(error),
		});
	}


	// Agents in a consumer nested inside a larger git repo sometimes echo
	// repo-ROOT-relative paths — computed once, threaded into every derivation
	// that normalizes report paths.
	const gitPrefix = await readGitPrefix({ cwd });

	const steps = buildSteps({ run, gitPrefix, planContent, overviewContent, standards, testStandards, skipRefactor });

	await update({ status: RunStatus.Running });

	for (const step of steps) {
		const prior = run.current().steps.find((record) => record.id === step.id);

		if (prior?.status === RunStatus.Passed) {
			continue;
		}

		const skipReason = step.skip?.();

		if (skipReason) {
			await setStep({
				record: { id: step.id, status: RunStatus.Passed, attempts: prior?.attempts ?? 0, report: { skipped: skipReason } },
			});
			progress(`step ${step.id} skipped (${skipReason})`);

			continue;
		}

		const stopped = await step.run();

		if (stopped) {
			return stopped;
		}
	}

	await update({ status: RunStatus.Passed, currentStep: null });

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
