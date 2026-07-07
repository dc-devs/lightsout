import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
	buildFeatureExecutorInvocation,
	buildRefactorExecutorInvocation,
	buildUnitTestWriterInvocation,
	formatFindingSite,
} from '@lightsout/agents';
import {
	PackagesSource,
	RunStatus,
	WorkReportStatus,
	type LightsoutConfig,
	type RunManifest,
	type ScanFinding,
	type StepRecord,
	type WorkReport,
} from '@lightsout/contracts';
import type { Driver } from '@lightsout/drivers';
import { appendCommandLog } from '../runState';
import { createRun } from '../runState';
import { readGitChangedFiles } from '../common/git/readGitChangedFiles';
import { readGitPrefix } from '../common/git/readGitPrefix';
import { readPlanPackages } from './readPlanPackages';
import { detectStandardsChannels } from '../standards';
import { readStandards } from '../standards';
import { withRunLock } from '../runState';
import { PipelineRun } from './PipelineRun';
import type { PipelineStep } from './PipelineStep';
import { collectChanged as collectChangedFor } from './common/utils/collectChanged';
import { gates as gatesFor } from './common/utils/gates';
import { sourceFiles as sourceFilesFor } from './common/utils/sourceFiles';
import { withStepFiles as withStepFilesFor } from './common/utils/withStepFiles';
import { refactorStep } from './steps/refactorStep';
import { verifyStep } from './steps/verifyStep';
import { writeTestsStep } from './steps/writeTestsStep';
import { workStep } from './steps/workStep';
import { scanPlanPackagePaths } from './scanPlanPackagePaths';
import { runCommand } from '../common/utils/runCommand';
import type { PipelineResult } from './PipelineResult';

const formatTimeoutMs = 10 * 60_000;
const maxRefactorPasses = 3;
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

	// The shared derivations, bound to this run (their files own the logic).
	const collectChanged = (reports: WorkReport[]) => collectChangedFor({ run, gitPrefix, reports });
	const withStepFiles = ({ record, reports }: { record: StepRecord; reports: WorkReport[] }) => withStepFilesFor({ record, reports, gitPrefix });
	const gates = ({ coverage }: { coverage?: boolean }) => gatesFor({ run, coverage });
	const sourceFiles = () => sourceFilesFor({ run });

	const cleanSlateStep: PipelineStep['run'] = async () => {
		const record = nextRecord({ id: 'clean-slate' });

		await setStep({ record });
		progress(`step clean-slate — attempt ${record.attempts}`);

		// Coverage runs here too: verify-tests holds the same bar later, so a
		// baseline that already misses it must be the consumer's problem, not
		// the run's.
		const error = await gates({ coverage: true });

		if (error) {
			return stop({
				record,
				status: RunStatus.Failed,
				error: `Codebase is not green before implementation — fix this first.\n${error}`,
			});
		}

		// Gate commands may produce artifacts (coverage output, logs). Fold
		// anything that appeared during clean-slate into the baseline so it is
		// never attributed to the run's agents.
		const gateArtifacts = await readGitChangedFiles({ cwd });

		await setStep({
			record: { ...record, status: RunStatus.Passed },
			patch: gateArtifacts
				? { baselineDirtyFiles: [...new Set([...run.current().baselineDirtyFiles, ...gateArtifacts])] }
				: undefined,
		});
		progress('step clean-slate passed');

		return undefined;
	};

	const formatStep: PipelineStep = {
		id: 'format',
		skip: () => (config.scripts.format ? undefined : 'no format command configured'),
		run: async () => {
			const formatCommand = config.scripts.format;

			if (!formatCommand) {
				return undefined;
			}

			const record = nextRecord({ id: 'format' });

			await setStep({ record });
			progress('step format — running formatter');

			const startedAt = Date.now();
			let result;

			try {
				result = await runCommand({ command: formatCommand, cwd, timeoutMs: formatTimeoutMs });
			} catch (error) {
				// A formatter that times out or fails to spawn is a red step, not a crash.
				result = { exitCode: -1, stdout: '', stderr: error instanceof Error ? error.message : String(error) };
			}

			await appendCommandLog({
				cwd,
				runId: run.current().runId,
				record: {
					at: new Date().toISOString(),
					step: 'format',
					group: 'root',
					kind: 'format',
					command: formatCommand,
					exitCode: result.exitCode,
					durationMs: Date.now() - startedAt,
					...(result.exitCode === 0 ? {} : { outputTail: `${result.stdout}\n${result.stderr}`.slice(-2000) }),
				},
			});

			if (result.exitCode !== 0) {
				return stop({
					record,
					status: RunStatus.Failed,
					error: `format failed (exit ${result.exitCode}):\n${result.stdout}\n${result.stderr}`,
				});
			}

			// A formatter should be behavior-preserving — verify anyway; a red
			// gate here means the formatter and the checks disagree, which is a
			// human's configuration problem, not an agent's.
			const error = await gates({ coverage: true });

			if (error) {
				return stop({ record, status: RunStatus.Failed, error: `format: formatting broke verification — review the formatter/gate configuration.\n${error}` });
			}

			// No changed-file merge here: the formatter only rewrites files the
			// run already tracks, and anything new it emits is artifact noise.
			await setStep({ record: { ...record, status: RunStatus.Passed } });
			progress('step format passed');

			return undefined;
		},
	};

	const refactorSteps: PipelineStep[] = skipRefactor
		? []
		: [
				{
					id: 'refactor',
					skip: () => (sourceFiles().length === 0 ? 'no changed source files to review' : undefined),
					run: refactorStep({ run, gitPrefix, planContent, standards }),
				},
				{
					id: 'verify-refactor',
					run: verifyStep({
						run,
						gitPrefix,
						planContent,
						id: 'verify-refactor',
						coverage: true,
						buildFix: (errorContext) =>
							buildRefactorExecutorInvocation({ planContent, changedFiles: sourceFiles(), standards, errorContext }),
					}),
				},
			];

	const steps: PipelineStep[] = [
		{ id: 'clean-slate', run: cleanSlateStep },
		{
			id: 'implement',
			run: workStep({
				run,
				gitPrefix,
				id: 'implement',
				requireChanges: true,
				build: () => buildFeatureExecutorInvocation({ planContent, overviewContent, standards, allowedCommands: config.agentCommands }),
			}),
		},
		{
			id: 'verify-implement',
			run: verifyStep({
				run,
				gitPrefix,
				planContent,
				id: 'verify-implement',
				buildFix: (errorContext) =>
					buildFeatureExecutorInvocation({
						planContent,
						overviewContent,
						standards,
						errorContext,
						changedFiles: run.current().changedFiles,
						allowedCommands: config.agentCommands,
					}),
			}),
		},
		{
			id: 'write-tests',
			skip: () => (sourceFiles().length === 0 ? 'no eligible source files' : undefined),
			run: writeTestsStep({ run, gitPrefix, planContent, testStandards }),
		},
		{
			id: 'verify-tests',
			run: verifyStep({
				run,
				gitPrefix,
				planContent,
				id: 'verify-tests',
				coverage: true,
				buildFix: (errorContext) =>
					buildUnitTestWriterInvocation({ planContent, changedFiles: sourceFiles(), standards: testStandards, errorContext }),
			}),
		},
		...refactorSteps,
		formatStep,
	];

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
