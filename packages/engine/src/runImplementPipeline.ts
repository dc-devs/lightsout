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
import { readStandards } from './readStandards';
import { runGates } from './runGates';
import { writeRunManifest } from './writeRunManifest';
import type { PipelineResult } from './PipelineResult';

const executorTimeoutMs = 20 * 60_000;
const supervisorTimeoutMs = 10 * 60_000;
const maxCheapFixRetries = 2;
const defaultPermissionMode = 'acceptEdits';
const supervisorPermissionMode = 'plan';

const isTestFilePath = (path: string) => /(^|\/)tests?\//.test(path) || /\.(test|spec)\./.test(path);

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
	/** Resume: an existing manifest — steps already passed are skipped. */
	existing?: RunManifest;
	skipRefactor?: boolean;
}

/**
 * The implement pipeline: clean-slate gate → implement → verify → write-tests
 * → verify → refactor → verify. Every state transition is persisted before
 * the next action, so a crash, rate-limit park, or escalation at any point
 * leaves a resumable, truthful record on disk — resume re-enters here and
 * walks past every step already marked passed.
 */
export const runImplementPipeline = async ({
	cwd,
	driver,
	config,
	planPath,
	existing,
	skipRefactor,
}: Params): Promise<PipelineResult> => {
	let manifest = existing ?? (await createRun({ cwd, plan: planPath ?? '', driver: driver.name }));

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

	const mergeChanged = (report: WorkReport) => [
		...new Set([...manifest.changedFiles, ...report.changedFiles.map((file) => file.path)]),
	];

	const sourceFiles = () => manifest.changedFiles.filter((file) => !isTestFilePath(file));

	const workStep = ({ id, build }: { id: string; build: () => { systemPrompt: string; prompt: string } }): PipelineStep['run'] => {
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

			await setStep({ record: { ...record, status: RunStatus.Passed, report }, patch: { changedFiles: mergeChanged(report) } });

			return undefined;
		};
	};

	const verifyStep = ({ id, buildFix }: { id: string; buildFix: (errorContext: string) => { systemPrompt: string; prompt: string } }): PipelineStep['run'] => {
		return async () => {
			let record = nextRecord({ id });

			await setStep({ record });

			let error = await runGates({ cwd, config });

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
					await setStep({ record: { ...record, report: fix.report }, patch: { changedFiles: mergeChanged(fix.report) } });
				}

				error = await runGates({ cwd, config });
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
						await setStep({ record: { ...record, report: fix.report }, patch: { changedFiles: mergeChanged(fix.report) } });
					}

					error = await runGates({ cwd, config });
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

		const error = await runGates({ cwd, config });

		if (error) {
			return stop({
				record,
				status: RunStatus.Failed,
				error: `Codebase is not green before implementation — fix this first.\n${error}`,
			});
		}

		await setStep({ record: { ...record, status: RunStatus.Passed } });

		return undefined;
	};

	const refactorSteps: PipelineStep[] = skipRefactor
		? []
		: [
				{
					id: 'refactor',
					skip: () => (manifest.changedFiles.length === 0 ? 'no changed files to review' : undefined),
					run: workStep({
						id: 'refactor',
						build: () => buildRefactorExecutorInvocation({ planContent, changedFiles: manifest.changedFiles, standards }),
					}),
				},
				{
					id: 'verify-refactor',
					run: verifyStep({
						id: 'verify-refactor',
						buildFix: (errorContext) =>
							buildRefactorExecutorInvocation({ planContent, changedFiles: manifest.changedFiles, standards, errorContext }),
					}),
				},
			];

	const steps: PipelineStep[] = [
		{ id: 'clean-slate', run: cleanSlateStep },
		{
			id: 'implement',
			run: workStep({ id: 'implement', build: () => buildFeatureExecutorInvocation({ planContent, standards }) }),
		},
		{
			id: 'verify-implement',
			run: verifyStep({
				id: 'verify-implement',
				buildFix: (errorContext) => buildFeatureExecutorInvocation({ planContent, standards, errorContext }),
			}),
		},
		{
			id: 'write-tests',
			skip: () => (sourceFiles().length === 0 ? 'no eligible source files' : undefined),
			run: workStep({
				id: 'write-tests',
				build: () => buildUnitTestWriterInvocation({ planContent, changedFiles: sourceFiles(), standards: testStandards }),
			}),
		},
		{
			id: 'verify-tests',
			run: verifyStep({
				id: 'verify-tests',
				buildFix: (errorContext) =>
					buildUnitTestWriterInvocation({ planContent, changedFiles: sourceFiles(), standards: testStandards, errorContext }),
			}),
		},
		...refactorSteps,
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
