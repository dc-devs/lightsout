import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
	buildFeatureExecutorInvocation,
	buildRefactorExecutorInvocation,
	buildSupervisorInvocation,
	buildUnitTestWriterInvocation,
} from '@lightsout/agents';
import {
	PackagesSource,
	RunStatus,
	SupervisorDecision,
	SupervisorVerdict,
	WorkReport,
	WorkReportStatus,
	type AgentUsage,
	type LightsoutConfig,
	type RunManifest,
	type StepRecord,
} from '@lightsout/contracts';
import type { Driver } from '@lightsout/drivers';
import { acquireRunLock } from './acquireRunLock';
import { appendAgentLog } from './appendAgentLog';
import { appendCommandLog } from './appendCommandLog';
import { appendFriction } from './appendFriction';
import { createRun } from './createRun';
import { getRunDir } from './getRunDir';
import { invokeAgentWithContract } from './invokeAgentWithContract';
import { readGitChangedFiles } from './readGitChangedFiles';
import { readPlanPackages } from './readPlanPackages';
import { detectStandardsChannels } from './detectStandardsChannels';
import { readStandards } from './readStandards';
import { releaseRunLock } from './releaseRunLock';
import { scanPlanPackagePaths } from './scanPlanPackagePaths';
import { runCommand } from './runCommand';
import { runGates } from './runGates';
import { writeRunManifest } from './writeRunManifest';
import type { PipelineResult } from './PipelineResult';

const defaultAgentTimeoutMinutes = 60;
const defaultSupervisorTimeoutMinutes = 15;
const formatTimeoutMs = 10 * 60_000;
const maxCheapFixRetries = 2;
const maxRefactorPasses = 3;
const testWriterConcurrency = 5;
const defaultPermissionMode = 'acceptEdits';
const supervisorPermissionMode = 'plan';

const isTestFilePath = (path: string) => /(^|\/)tests?\//.test(path) || /\.(test|spec)\./.test(path);

const formatTokens = (count: number) => (count >= 1000 ? `${(count / 1000).toFixed(1)}k` : `${count}`);

const formatUsage = (usage: AgentUsage) =>
	`in ${formatTokens(usage.inputTokens)} · out ${formatTokens(usage.outputTokens)} · cache-read ${formatTokens(usage.cacheReadTokens)} · $${usage.costUsd.toFixed(2)}`;

/**
 * Only the JS/TS family earns agent turns (test writers, refactor review) —
 * every spawn costs a model call, so unknown file types default to zero
 * wasted turns. Allowlist: .js/.jsx/.ts/.tsx plus the m/c module variants.
 */
const isTestableSourceFile = (path: string) => /\.(m|c)?[jt]sx?$/i.test(path);

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
	const progress = onProgress ?? (() => undefined);

	let manifest =
		existing ??
		(await createRun({
			cwd,
			runId,
			plan: planPath ?? '',
			overview: overviewPath,
			driver: driver.name,
			config,
			baselineDirtyFiles: await readGitChangedFiles({ cwd }),
		}));

	// Run-wide usage aggregate, seeded from the manifest on resume so totals
	// survive process boundaries. Mutated by recordAgentUsage (below) and
	// stamped into every manifest write. agents.jsonl holds the per-invocation
	// ledger; this is just the sum.
	const usageTotals = {
		invocations: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheCreationTokens: 0,
		costUsd: 0,
		...manifest.usage,
	};

	const update = async (patch: Partial<RunManifest>) => {
		const usage = usageTotals.invocations > 0 ? { ...usageTotals } : manifest.usage;

		manifest = await writeRunManifest({ cwd, manifest: { ...manifest, ...patch, usage } });
	};

	const recordAgentUsage = async ({ step, usage }: { step: string; usage?: AgentUsage }) => {
		if (!usage) {
			return;
		}

		usageTotals.invocations += 1;
		usageTotals.inputTokens += usage.inputTokens;
		usageTotals.outputTokens += usage.outputTokens;
		usageTotals.cacheReadTokens += usage.cacheReadTokens;
		usageTotals.cacheCreationTokens += usage.cacheCreationTokens;
		usageTotals.costUsd += usage.costUsd;

		await appendAgentLog({
			cwd,
			runId: manifest.runId,
			record: { at: new Date().toISOString(), step, model: config.model, ...usage },
		});
		progress(`  ${step} · usage: ${formatUsage(usage)}`);
	};

	// Active time per step, accumulated across attempts and resumes: the
	// timer starts when nextRecord picks the step up (seeded with any prior
	// durationMs), and every manifest write re-stamps the running total — so
	// even a crashed run keeps the duration up to its last persisted moment.
	const stepTimers = new Map<string, { startedAt: number; baseMs: number }>();

	const setStep = async ({ record, patch }: { record: StepRecord; patch?: Partial<RunManifest> }) => {
		const timer = stepTimers.get(record.id);
		const timed = timer ? { ...record, durationMs: timer.baseMs + (Date.now() - timer.startedAt) } : record;

		await update({ ...patch, currentStep: timed.id, steps: upsertStep({ steps: manifest.steps, record: timed }) });
	};

	const stop = async ({ record, status, error }: { record: StepRecord; status: RunStatus; error: string }) => {
		await setStep({ record: { ...record, status, error }, patch: { status } });
		progress(`run stopped at ${record.id} — ${status}`);

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

	const packagesDir = config.packagesDir ?? 'packages';

	// Monorepo mode needs a scope before any gate runs. The chain: --packages
	// flag → plan front-matter → concrete package paths in the plan body (safe
	// fallback: over-inclusion only runs extra gates, under-inclusion is
	// caught by scope expansion) → hard error. Never inference beyond that.
	if (config.packageScripts && manifest.packages.length === 0) {
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

	if (manifest.packages.length > 0) {
		progress(`package scope: ${manifest.packages.join(', ')} (from ${manifest.packagesSource ?? 'manifest'})`);
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
		config.standardsChannels ?? (await detectStandardsChannels({ cwd, packagesDir, packages: manifest.packages }));

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

	const nextRecord = ({ id }: { id: string }): StepRecord => {
		const prev = manifest.steps.find((step) => step.id === id);

		stepTimers.set(id, { startedAt: Date.now(), baseMs: prev?.durationMs ?? 0 });

		return { id, status: RunStatus.Running, attempts: (prev?.attempts ?? 0) + 1, changedFiles: prev?.changedFiles };
	};

	const agentTimeoutMs = (config.timeouts?.agentMinutes ?? defaultAgentTimeoutMinutes) * 60_000;
	const supervisorTimeoutMs = (config.timeouts?.supervisorMinutes ?? defaultSupervisorTimeoutMinutes) * 60_000;

	// Every agent invocation's full event stream (tool calls, chat text, the
	// final result) is teed to agents/stream-NN-<step>.jsonl — the chat as
	// on-disk run evidence, tail-able live for anyone who wants the
	// play-by-play. The progress stream stays quiet per event: a working
	// agent fires tools every few seconds, and narrating each one drowned
	// the terminal. Evidence only: outcomes never depend on it.
	let transcriptCount = 0;

	const agentEventSink = (step: string) => {
		transcriptCount += 1;

		const dir = join(getRunDir({ cwd, runId: manifest.runId }), 'agents');
		const path = join(dir, `stream-${String(transcriptCount).padStart(2, '0')}-${step}.jsonl`);
		// Serialize appends so events land in arrival order even though the
		// sink itself must return synchronously to the driver's read loop.
		let tail: Promise<unknown> = mkdir(dir, { recursive: true });

		return (event: unknown) => {
			tail = tail.then(() => appendFile(path, `${JSON.stringify(event)}\n`, 'utf8')).catch(() => undefined);
		};
	};

	// A final message that fails its contract is still evidence — persist it
	// to the run dir before any retry, so a rejected report never has to be
	// recovered from harness-internal session files again.
	let rejectedCount = 0;

	const persistRejected =
		(step: string) =>
		async ({ text, attempt, validationError }: { text: string; attempt: number; validationError: string }) => {
			rejectedCount += 1;

			const dir = join(getRunDir({ cwd, runId: manifest.runId }), 'agents');
			const name = `rejected-${String(rejectedCount).padStart(2, '0')}-${step}-attempt${attempt}.txt`;

			await mkdir(dir, { recursive: true });
			await writeFile(join(dir, name), `# step: ${step} · invocation attempt ${attempt}\n# validation: ${validationError}\n\n${text}`, 'utf8');
			progress(`step ${step}: agent final message failed the report contract — raw text saved to .lightsout/runs/${manifest.runId}/agents/${name}`);
		};

	const invokeRole = async (invocation: { systemPrompt: string; prompt: string }, step: string) => {
		const outcome = await invokeAgentWithContract({
			driver,
			cwd,
			invocation,
			contract: WorkReport,
			model: config.model,
			permissionMode: config.permissionMode ?? defaultPermissionMode,
			timeoutMs: agentTimeoutMs,
			// Harness-level allowance for all working roles; the binding grant
			// is the prompt section, which only the executor's builder emits.
			allowedCommands: config.agentCommands,
			onEvent: agentEventSink(step),
			onRejectedOutput: persistRejected(step),
		});

		await recordAgentUsage({ step, usage: outcome.usage });

		return outcome;
	};

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
	// Generated/derived files (configured prefixes) are like gate artifacts:
	// real in the diff, but never attributed — their source is the change.
	const isGeneratedFile = (file: string) => (config.generated ?? []).some((prefix) => file.startsWith(prefix));

	const collectChanged = async (reports: WorkReport[]) => {
		const fromGit = ((await readGitChangedFiles({ cwd })) ?? []).filter(
			(file) => !manifest.baselineDirtyFiles.includes(file) && !isGeneratedFile(file),
		);
		const fromReports = reports.flatMap((report) => report.changedFiles.map((file) => file.path)).filter((file) => !isGeneratedFile(file));
		const changedFiles = [...new Set([...manifest.changedFiles, ...fromReports, ...fromGit])];
		const fromFiles = changedFiles.flatMap((file) => {
			const packageDir = packageOf(file);

			return packageDir ? [packageDir] : [];
		});

		return { changedFiles, packages: [...new Set([...manifest.packages, ...fromFiles])] };
	};

	const hasRootChanges = () => manifest.changedFiles.some((file) => packageOf(file) === undefined);

	const gates = ({ coverage }: { coverage?: boolean }) =>
		runGates({
			cwd,
			config,
			coverage,
			packages: manifest.packages,
			includeRoot: hasRootChanges(),
			runId: manifest.runId,
			step: manifest.currentStep ?? undefined,
			onProgress,
		});

	const sourceFiles = () => manifest.changedFiles.filter((file) => !isTestFilePath(file) && isTestableSourceFile(file));

	/** Merge report file paths into the step record's own attribution (per-step view of the run-wide `changedFiles`). */
	const withStepFiles = ({ record, reports }: { record: StepRecord; reports: WorkReport[] }): StepRecord => ({
		...record,
		changedFiles: [
			...new Set([...(record.changedFiles ?? []), ...reports.flatMap((report) => report.changedFiles.map((file) => file.path))]),
		],
	});

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
			progress(`step ${id} — attempt ${record.attempts} · invoking agent (ceiling ${agentTimeoutMs / 60_000}m)`);

			const { report, failure, rateLimited } = await invokeRole(build(), id);

			if (rateLimited) {
				return stop({ record, status: RunStatus.PausedRateLimit, error: parkMessage() });
			}

			if (!report) {
				return stop({ record, status: RunStatus.Failed, error: failure ?? 'unknown failure' });
			}

			progress(`step ${id}: agent report ${report.status} — ${report.changedFiles.length} changed file(s)`);

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

			await setStep({ record: withStepFiles({ record: { ...record, status: RunStatus.Passed, report }, reports: [report] }), patch: changed });
			progress(`step ${id} passed`);

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
			progress(`step ${id} — attempt ${record.attempts}`);

			let error = await gates({ coverage });

			// Cheap mechanical retries: hand the role the gate output and re-verify.
			for (let retry = 1; error && retry <= maxCheapFixRetries; retry += 1) {
				record = { ...record, attempts: record.attempts + 1 };

				await setStep({ record });
				progress(`step ${id}: gate red — fix attempt ${retry}/${maxCheapFixRetries}`);

				const fix = await invokeRole(buildFix(error), id);

				if (fix.rateLimited) {
					return stop({ record, status: RunStatus.PausedRateLimit, error: parkMessage() });
				}

				if (fix.report) {
					await appendFriction({ cwd, runId: manifest.runId, step: id, friction: fix.report.friction ?? [] });
				}

				if (fix.report?.status === WorkReportStatus.Complete) {
					record = withStepFiles({ record, reports: [fix.report] });

					await setStep({ record: { ...record, report: fix.report }, patch: await collectChanged([fix.report]) });
				}

				error = await gates({ coverage });
			}

			// Exception path: mechanical retries exhausted — bring in judgment.
			if (error) {
				progress(`step ${id}: mechanical retries exhausted — consulting supervisor (ceiling ${supervisorTimeoutMs / 60_000}m)`);

				const verdict = await invokeAgentWithContract({
					driver,
					cwd,
					invocation: buildSupervisorInvocation({ planContent, stepId: id, errorOutput: error, attempts: record.attempts }),
					contract: SupervisorVerdict,
					model: config.model,
					permissionMode: supervisorPermissionMode,
					timeoutMs: supervisorTimeoutMs,
					onEvent: agentEventSink(`${id}-supervisor`),
					onRejectedOutput: persistRejected(`${id}-supervisor`),
				});

				await recordAgentUsage({ step: `${id}-supervisor`, usage: verdict.usage });

				if (verdict.rateLimited) {
					return stop({ record, status: RunStatus.PausedRateLimit, error: parkMessage() });
				}

				if (verdict.report) {
					progress(`step ${id}: supervisor verdict — ${verdict.report.decision}`);
				}

				if (verdict.report?.decision === SupervisorDecision.Retry && verdict.report.guidance) {
					record = { ...record, attempts: record.attempts + 1 };

					await setStep({ record });

					const fix = await invokeRole(
						buildFix(`${error}\n\n# Supervisor diagnosis\n${verdict.report.diagnosis}\n\n# Supervisor guidance\n${verdict.report.guidance}`),
						id,
					);

					if (fix.rateLimited) {
						return stop({ record, status: RunStatus.PausedRateLimit, error: parkMessage() });
					}

					if (fix.report) {
						await appendFriction({ cwd, runId: manifest.runId, step: id, friction: fix.report.friction ?? [] });
					}

					if (fix.report?.status === WorkReportStatus.Complete) {
						record = withStepFiles({ record, reports: [fix.report] });

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
			progress(`step ${id} passed`);

			return undefined;
		};
	};

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
				? { baselineDirtyFiles: [...new Set([...manifest.baselineDirtyFiles, ...gateArtifacts])] }
				: undefined,
		});
		progress('step clean-slate passed');

		return undefined;
	};

	const writeTestsStep: PipelineStep['run'] = async () => {
		let record = nextRecord({ id: 'write-tests' });

		await setStep({ record });

		// One writer per source file, batches run in parallel — writers touch
		// disjoint test files, so they cannot collide on disk.
		const targets = sourceFiles();

		progress(`step write-tests — attempt ${record.attempts} · ${targets.length} file(s), up to ${testWriterConcurrency} writers in parallel`);
		const reports: WorkReport[] = [];
		const failures: string[] = [];
		let terminated = false;
		let parked = false;

		for (let start = 0; start < targets.length && !parked; start += testWriterConcurrency) {
			const batch = targets.slice(start, start + testWriterConcurrency);
			const results = await Promise.all(
				batch.map(async (file) => ({
					file,
					...(await invokeRole(buildUnitTestWriterInvocation({ planContent, changedFiles: [file], standards: testStandards }), 'write-tests')),
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
				progress(`write-tests: ${result.file} — ${result.report.status}`);

				if (result.report.status !== WorkReportStatus.Complete) {
					terminated = terminated || result.report.status !== WorkReportStatus.Failed;
					failures.push(`${result.file}: ${result.report.status} — ${result.report.failures.join('; ')}`);
				}
			}
		}

		// Persist whatever progress the batches made before deciding the
		// outcome — a parked or stopped run must still know what was touched.
		record = withStepFiles({ record, reports });

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
		progress('step write-tests passed');

		return undefined;
	};

	const refactorStep: PipelineStep['run'] = async () => {
		let record = nextRecord({ id: 'refactor' });
		let lastReport: WorkReport | undefined;

		// Iterate until a pass reports complete with zero changed files — the
		// typed "nothing left to improve" signal — capped at maxRefactorPasses.
		for (let pass = 1; pass <= maxRefactorPasses; pass += 1) {
			await setStep({ record });
			progress(`step refactor — pass ${pass}/${maxRefactorPasses}`);

			const { report, failure, rateLimited } = await invokeRole(
				buildRefactorExecutorInvocation({ planContent, changedFiles: sourceFiles(), standards }),
				'refactor',
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

			record = withStepFiles({ record, reports: [report] });

			await setStep({ record: { ...record, report }, patch: await collectChanged([report]) });
			lastReport = report;

			if (report.changedFiles.length === 0) {
				progress(`refactor pass ${pass}: no changes — loop complete`);
				break;
			}

			progress(`refactor pass ${pass}: ${report.changedFiles.length} change(s)`);
			record = { ...record, attempts: record.attempts + 1 };
		}

		await setStep({ record: { ...record, status: RunStatus.Passed, report: lastReport } });
		progress('step refactor passed');

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
				runId: manifest.runId,
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
				build: () => buildFeatureExecutorInvocation({ planContent, overviewContent, standards, allowedCommands: config.agentCommands }),
			}),
		},
		{
			id: 'verify-implement',
			run: verifyStep({
				id: 'verify-implement',
				buildFix: (errorContext) =>
					buildFeatureExecutorInvocation({
						planContent,
						overviewContent,
						standards,
						errorContext,
						changedFiles: manifest.changedFiles,
						allowedCommands: config.agentCommands,
					}),
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
			progress(`step ${step.id} skipped (${skipReason})`);

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

/**
 * Public entry: take the repo's run lock, execute the pipeline, always
 * release. Acquisition happens before ANY disk write (the run id is minted
 * here so the lock can name it), so a conflicting start leaves no orphan run
 * directory — it throws RunLockError and nothing else happened. Every exit
 * path releases, including parks and escalations: the lock guards the
 * process, not the run, and `resume` re-acquires.
 */
export const runImplementPipeline = async (params: Params): Promise<PipelineResult> => {
	const { cwd, existing, onProgress } = params;
	const runId = existing?.runId ?? randomUUID();
	const lock = await acquireRunLock({ cwd, runId });

	if (lock.stalePid !== undefined) {
		onProgress?.(`stale run lock from dead pid ${lock.stalePid} — taking over`);
	}

	try {
		return await executePipeline({ ...params, runId });
	} finally {
		await releaseRunLock({ cwd, runId });
	}
};
