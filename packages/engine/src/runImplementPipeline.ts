import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
	buildFeatureExecutorInvocation,
	buildRefactorExecutorInvocation,
	buildSupervisorInvocation,
	buildUnitTestWriterInvocation,
} from '@lightsout/agents';
import {
	RunStatus,
	SupervisorDecision,
	SupervisorVerdict,
	WorkReport,
	WorkReportStatus,
	type LightsoutConfig,
	type RunManifest,
	type StepRecord,
} from '@lightsout/contracts';
import type { Driver } from '@lightsout/drivers';
import { appendFriction } from './appendFriction';
import { createRun } from './createRun';
import { invokeAgentWithContract } from './invokeAgentWithContract';
import { readGitChangedFiles } from './readGitChangedFiles';
import { readPlanPackages } from './readPlanPackages';
import { readStandards } from './readStandards';
import { runCommand } from './runCommand';
import { runGates } from './runGates';
import { writeRunManifest } from './writeRunManifest';
import type { PipelineResult } from './PipelineResult';

const executorTimeoutMs = 20 * 60_000;
const supervisorTimeoutMs = 10 * 60_000;
const formatTimeoutMs = 10 * 60_000;
const maxCheapFixRetries = 2;
const maxRefactorPasses = 3;
const testWriterConcurrency = 5;
const defaultPermissionMode = 'acceptEdits';
const supervisorPermissionMode = 'plan';

const isTestFilePath = (path: string) => /(^|\/)tests?\//.test(path) || /\.(test|spec)\./.test(path);

/** Data/asset/doc files no test-writing or refactoring role should be handed. */
const isNonCodeFilePath = (path: string) =>
	/\.(json|jsonc|md|markdown|yml|yaml|toml|lock|lockb|svg|png|jpe?g|gif|ico|snap|txt|csv|sql|log)$/i.test(path);

const upsertStep = ({ steps, record }: { steps: StepRecord[]; record: StepRecord }) => {
	const existing = steps.findIndex((step) => step.id === record.id);

	if (existing === -1) {
		return [...steps, record];
	}

	return steps.map((step, index) => (index === existing ? record : step));
};

interface PipelineStep {
	id: string;
	/** Returns a skip reason when the step has nothing to do (recorded, counted as passed). */
	skip?: () => string | undefined;
	run: () => Promise<PipelineResult | undefined>;
}

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
}

/**
 * The implement pipeline: clean-slate gate → implement → verify → write-tests
 * (one writer per source file, in parallel) → verify → refactor (looped until
 * a pass changes nothing) → verify → format. Every state transition is
 * persisted before the next action, so a crash, rate-limit park, or
 * escalation at any point leaves a resumable, truthful record on disk —
 * resume re-enters here and walks past every step already marked passed.
 *
 * Changed files flow step to step through the manifest: each agent's typed
 * report is merged with a git snapshot (minus the run's baseline dirt), and
 * the merged list feeds the next role's invocation.
 */
export const runImplementPipeline = async ({
	cwd,
	driver,
	config,
	planPath,
	overviewPath,
	packages,
	existing,
	skipRefactor,
}: Params): Promise<PipelineResult> => {
	let manifest =
		existing ??
		(await createRun({
			cwd,
			plan: planPath ?? '',
			overview: overviewPath,
			driver: driver.name,
			baselineDirtyFiles: await readGitChangedFiles({ cwd }),
		}));

	const update = async (patch: Partial<RunManifest>) => {
		manifest = await writeRunManifest({ cwd, manifest: { ...manifest, ...patch } });
	};

	const setStep = async ({ record, patch }: { record: StepRecord; patch?: Partial<RunManifest> }) => {
		await update({ ...patch, currentStep: record.id, steps: upsertStep({ steps: manifest.steps, record }) });
	};

	const stop = async ({ record, status, error }: { record: StepRecord; status: RunStatus; error: string }) => {
		await setStep({ record: { ...record, status, error }, patch: { status } });

		const stopped: PipelineResult = { ok: false, manifest, error };

		return stopped;
	};

	const parkMessage = () =>
		`run parked: harness rate limit reached — resume with \`lightsout resume --run ${manifest.runId}\` when the window resets.`;

	const planContent = await readFile(join(cwd, manifest.plan), 'utf8').catch(() => undefined);

	if (planContent === undefined) {
		return stop({
			record: { id: 'clean-slate', status: RunStatus.Running, attempts: 0 },
			status: RunStatus.Failed,
			error: `plan file not found: ${join(cwd, manifest.plan)}`,
		});
	}

	const overviewContent = manifest.overview
		? await readFile(join(cwd, manifest.overview), 'utf8').catch(() => undefined)
		: undefined;

	if (manifest.overview && overviewContent === undefined) {
		return stop({
			record: { id: 'clean-slate', status: RunStatus.Running, attempts: 0 },
			status: RunStatus.Failed,
			error: `overview file not found: ${join(cwd, manifest.overview)}`,
		});
	}

	let standards: string | undefined;
	let testStandards: string | undefined;

	try {
		standards = await readStandards({ cwd, paths: config.standards ?? [] });
		testStandards = await readStandards({ cwd, paths: config.testStandards ?? [] });
	} catch (error) {
		return stop({
			record: { id: 'clean-slate', status: RunStatus.Running, attempts: 0 },
			status: RunStatus.Failed,
			error: error instanceof Error ? error.message : String(error),
		});
	}

	// Monorepo mode needs a scope before any gate runs: explicit --packages
	// beats the plan's front-matter; silence is a hard error, never a guess.
	if (config.packageScripts && manifest.packages.length === 0) {
		const declared = packages ?? readPlanPackages({ planContent }) ?? [];

		if (declared.length === 0) {
			return stop({
				record: { id: 'clean-slate', status: RunStatus.Running, attempts: 0 },
				status: RunStatus.Failed,
				error: 'packageScripts is configured but the run has no package scope — add a `packages:` list to the plan front-matter or pass --packages <a,b>.',
			});
		}

		await update({ packages: declared });
	}

	const nextRecord = ({ id }: { id: string }): StepRecord => {
		const prev = manifest.steps.find((step) => step.id === id);

		return { id, status: RunStatus.Running, attempts: (prev?.attempts ?? 0) + 1 };
	};

	const invokeRole = (invocation: { systemPrompt: string; prompt: string }) =>
		invokeAgentWithContract({
			driver,
			cwd,
			invocation,
			contract: WorkReport,
			model: config.model,
			permissionMode: config.permissionMode ?? defaultPermissionMode,
			timeoutMs: executorTimeoutMs,
		});

	const packagesDir = config.packagesDir ?? 'packages';

	/** Map a changed file to its package directory, or undefined for root-group files. */
	const packageOf = (file: string) => {
		const prefix = `${packagesDir}/`;

		if (!file.startsWith(prefix)) {
			return undefined;
		}

		const rest = file.slice(prefix.length);
		const separator = rest.indexOf('/');

		return separator > 0 ? rest.slice(0, separator) : undefined;
	};

	/**
	 * Merge the two sources of changed-file truth: what agents reported and
	 * what git actually observed (minus the run's baseline dirt). Agents can
	 * forget files; git cannot be sweet-talked. Also widens the package scope
	 * to whatever the changed files reveal — declared scope is a starting
	 * point, changed files are the truth; scope never shrinks.
	 */
	const collectChanged = async (reports: WorkReport[]) => {
		const fromGit = ((await readGitChangedFiles({ cwd })) ?? []).filter((file) => !manifest.baselineDirtyFiles.includes(file));
		const fromReports = reports.flatMap((report) => report.changedFiles.map((file) => file.path));
		const changedFiles = [...new Set([...manifest.changedFiles, ...fromReports, ...fromGit])];
		const fromFiles = changedFiles.flatMap((file) => {
			const packageDir = packageOf(file);

			return packageDir ? [packageDir] : [];
		});

		return { changedFiles, packages: [...new Set([...manifest.packages, ...fromFiles])] };
	};

	const hasRootChanges = () => manifest.changedFiles.some((file) => packageOf(file) === undefined);

	const gates = ({ coverage }: { coverage?: boolean }) =>
		runGates({ cwd, config, coverage, packages: manifest.packages, includeRoot: hasRootChanges() });

	const sourceFiles = () => manifest.changedFiles.filter((file) => !isTestFilePath(file) && !isNonCodeFilePath(file));

	const workStep = ({
		id,
		build,
		requireChanges,
	}: {
		id: string;
		build: () => { systemPrompt: string; prompt: string };
		/** Fail the run when the step completes without changing anything — a no-op "success" is a lie. */
		requireChanges?: boolean;
	}): PipelineStep['run'] => {
		return async () => {
			const record = nextRecord({ id });

			await setStep({ record });

			const { report, failure, rateLimited } = await invokeRole(build());

			if (rateLimited) {
				return stop({ record, status: RunStatus.PausedRateLimit, error: parkMessage() });
			}

			if (!report) {
				return stop({ record, status: RunStatus.Failed, error: failure ?? 'unknown failure' });
			}

			// Friction is captured regardless of outcome — a terminated run's
			// confusion is exactly the signal the improvement loop needs.
			await appendFriction({ cwd, runId: manifest.runId, step: id, friction: report.friction ?? [] });

			if (report.status !== WorkReportStatus.Complete) {
				// Termination statuses need a human (plan defect, scope); a plain
				// failed report is a failure. Both stop the run; only the state differs.
				const status = report.status === WorkReportStatus.Failed ? RunStatus.Failed : RunStatus.Escalated;

				return stop({
					record: { ...record, report },
					status,
					error: `${id}: ${report.status} — ${report.failures.join('; ')}`,
				});
			}

			const changed = await collectChanged([report]);

			if (requireChanges && changed.changedFiles.length === 0) {
				return stop({
					record: { ...record, report },
					status: RunStatus.Failed,
					error: `${id}: agent reported complete but neither its report nor git shows a single changed file — nothing was implemented, and a green verify on an unchanged codebase would be a misleading success.`,
				});
			}

			await setStep({ record: { ...record, status: RunStatus.Passed, report }, patch: changed });

			return undefined;
		};
	};

	const verifyStep = ({
		id,
		coverage,
		buildFix,
	}: {
		id: string;
		/** Run the coverage gate in this verify — only once tests for the new code exist. */
		coverage?: boolean;
		buildFix: (errorContext: string) => { systemPrompt: string; prompt: string };
	}): PipelineStep['run'] => {
		return async () => {
			let record = nextRecord({ id });

			await setStep({ record });

			let error = await gates({ coverage });

			// Cheap mechanical retries: hand the role the gate output and re-verify.
			for (let retry = 1; error && retry <= maxCheapFixRetries; retry += 1) {
				record = { ...record, attempts: record.attempts + 1 };

				await setStep({ record });

				const fix = await invokeRole(buildFix(error));

				if (fix.rateLimited) {
					return stop({ record, status: RunStatus.PausedRateLimit, error: parkMessage() });
				}

				if (fix.report) {
					await appendFriction({ cwd, runId: manifest.runId, step: id, friction: fix.report.friction ?? [] });
				}

				if (fix.report?.status === WorkReportStatus.Complete) {
					await setStep({ record: { ...record, report: fix.report }, patch: await collectChanged([fix.report]) });
				}

				error = await gates({ coverage });
			}

			// Exception path: mechanical retries exhausted — bring in judgment.
			if (error) {
				const verdict = await invokeAgentWithContract({
					driver,
					cwd,
					invocation: buildSupervisorInvocation({ planContent, stepId: id, errorOutput: error, attempts: record.attempts }),
					contract: SupervisorVerdict,
					model: config.model,
					permissionMode: supervisorPermissionMode,
					timeoutMs: supervisorTimeoutMs,
				});

				if (verdict.rateLimited) {
					return stop({ record, status: RunStatus.PausedRateLimit, error: parkMessage() });
				}

				if (verdict.report?.decision === SupervisorDecision.Retry && verdict.report.guidance) {
					record = { ...record, attempts: record.attempts + 1 };

					await setStep({ record });

					const fix = await invokeRole(
						buildFix(`${error}\n\n# Supervisor diagnosis\n${verdict.report.diagnosis}\n\n# Supervisor guidance\n${verdict.report.guidance}`),
					);

					if (fix.rateLimited) {
						return stop({ record, status: RunStatus.PausedRateLimit, error: parkMessage() });
					}

					if (fix.report) {
						await appendFriction({ cwd, runId: manifest.runId, step: id, friction: fix.report.friction ?? [] });
					}

					if (fix.report?.status === WorkReportStatus.Complete) {
						await setStep({ record: { ...record, report: fix.report }, patch: await collectChanged([fix.report]) });
					}

					error = await gates({ coverage });
				}

				if (error) {
					const diagnosis = verdict.report ? `\nsupervisor (${verdict.report.decision}): ${verdict.report.diagnosis}` : '';

					return stop({ record, status: RunStatus.Escalated, error: `${id}: still failing after retries.${diagnosis}\n\n${error}` });
				}
			}

			await setStep({ record: { ...record, status: RunStatus.Passed } });

			return undefined;
		};
	};

	const cleanSlateStep: PipelineStep['run'] = async () => {
		const record = nextRecord({ id: 'clean-slate' });

		await setStep({ record });

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
				? { baselineDirtyFiles: [...new Set([...manifest.baselineDirtyFiles, ...gateArtifacts])] }
				: undefined,
		});

		return undefined;
	};

	const writeTestsStep: PipelineStep['run'] = async () => {
		const record = nextRecord({ id: 'write-tests' });

		await setStep({ record });

		// One writer per source file, batches run in parallel — writers touch
		// disjoint test files, so they cannot collide on disk.
		const targets = sourceFiles();
		const reports: WorkReport[] = [];
		const failures: string[] = [];
		let terminated = false;
		let parked = false;

		for (let start = 0; start < targets.length && !parked; start += testWriterConcurrency) {
			const batch = targets.slice(start, start + testWriterConcurrency);
			const results = await Promise.all(
				batch.map(async (file) => ({
					file,
					...(await invokeRole(buildUnitTestWriterInvocation({ planContent, changedFiles: [file], standards: testStandards }))),
				})),
			);

			for (const result of results) {
				if (result.rateLimited) {
					parked = true;
					continue;
				}

				if (!result.report) {
					failures.push(`${result.file}: ${result.failure ?? 'unknown failure'}`);
					continue;
				}

				await appendFriction({ cwd, runId: manifest.runId, step: 'write-tests', friction: result.report.friction ?? [] });
				reports.push(result.report);

				if (result.report.status !== WorkReportStatus.Complete) {
					terminated = terminated || result.report.status !== WorkReportStatus.Failed;
					failures.push(`${result.file}: ${result.report.status} — ${result.report.failures.join('; ')}`);
				}
			}
		}

		// Persist whatever progress the batches made before deciding the
		// outcome — a parked or stopped run must still know what was touched.
		await setStep({ record: { ...record, report: { reports } }, patch: await collectChanged(reports) });

		if (parked) {
			return stop({ record: { ...record, report: { reports } }, status: RunStatus.PausedRateLimit, error: parkMessage() });
		}

		if (failures.length > 0) {
			return stop({
				record: { ...record, report: { reports } },
				status: terminated ? RunStatus.Escalated : RunStatus.Failed,
				error: `write-tests: ${failures.length} of ${targets.length} writer(s) did not complete:\n${failures.join('\n')}`,
			});
		}

		await setStep({ record: { ...record, status: RunStatus.Passed, report: { reports } } });

		return undefined;
	};

	const refactorStep: PipelineStep['run'] = async () => {
		let record = nextRecord({ id: 'refactor' });
		let lastReport: WorkReport | undefined;

		// Iterate until a pass reports complete with zero changed files — the
		// typed "nothing left to improve" signal — capped at maxRefactorPasses.
		for (let pass = 1; pass <= maxRefactorPasses; pass += 1) {
			await setStep({ record });

			const { report, failure, rateLimited } = await invokeRole(
				buildRefactorExecutorInvocation({ planContent, changedFiles: sourceFiles(), standards }),
			);

			if (rateLimited) {
				return stop({ record, status: RunStatus.PausedRateLimit, error: parkMessage() });
			}

			if (!report) {
				return stop({ record, status: RunStatus.Failed, error: failure ?? 'unknown failure' });
			}

			await appendFriction({ cwd, runId: manifest.runId, step: 'refactor', friction: report.friction ?? [] });

			if (report.status !== WorkReportStatus.Complete) {
				const status = report.status === WorkReportStatus.Failed ? RunStatus.Failed : RunStatus.Escalated;

				return stop({ record: { ...record, report }, status, error: `refactor: ${report.status} — ${report.failures.join('; ')}` });
			}

			await setStep({ record: { ...record, report }, patch: await collectChanged([report]) });
			lastReport = report;

			if (report.changedFiles.length === 0) {
				break;
			}

			record = { ...record, attempts: record.attempts + 1 };
		}

		await setStep({ record: { ...record, status: RunStatus.Passed, report: lastReport } });

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

			const result = await runCommand({ command: formatCommand, cwd, timeoutMs: formatTimeoutMs });

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

			return undefined;
		},
	};

	const refactorSteps: PipelineStep[] = skipRefactor
		? []
		: [
				{
					id: 'refactor',
					skip: () => (sourceFiles().length === 0 ? 'no changed source files to review' : undefined),
					run: refactorStep,
				},
				{
					id: 'verify-refactor',
					run: verifyStep({
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
				id: 'implement',
				requireChanges: true,
				build: () => buildFeatureExecutorInvocation({ planContent, overviewContent, standards }),
			}),
		},
		{
			id: 'verify-implement',
			run: verifyStep({
				id: 'verify-implement',
				buildFix: (errorContext) =>
					buildFeatureExecutorInvocation({ planContent, overviewContent, standards, errorContext, changedFiles: manifest.changedFiles }),
			}),
		},
		{
			id: 'write-tests',
			skip: () => (sourceFiles().length === 0 ? 'no eligible source files' : undefined),
			run: writeTestsStep,
		},
		{
			id: 'verify-tests',
			run: verifyStep({
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
		const prior = manifest.steps.find((record) => record.id === step.id);

		if (prior?.status === RunStatus.Passed) {
			continue;
		}

		const skipReason = step.skip?.();

		if (skipReason) {
			await setStep({
				record: { id: step.id, status: RunStatus.Passed, attempts: prior?.attempts ?? 0, report: { skipped: skipReason } },
			});

			continue;
		}

		const stopped = await step.run();

		if (stopped) {
			return stopped;
		}
	}

	await update({ status: RunStatus.Passed, currentStep: null });

	const passed: PipelineResult = { ok: true, manifest };

	return passed;
};
