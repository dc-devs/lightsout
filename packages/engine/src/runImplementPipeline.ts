import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildFeatureExecutorInvocation } from '@lightsout/agents';
import {
	ImplementReport,
	ImplementReportStatus,
	RunStatus,
	type LightsoutConfig,
	type RunManifest,
	type StepRecord,
} from '@lightsout/contracts';
import type { Driver } from '@lightsout/drivers';
import { createRun } from './createRun';
import { extractJsonReport } from './extractJsonReport';
import { runCommand } from './runCommand';
import { writeRunManifest } from './writeRunManifest';
import type { PipelineResult } from './PipelineResult';

const maxReportAttempts = 2;
const maxVerifyRetries = 2;
const executorTimeoutMs = 20 * 60_000;
const gateTimeoutMs = 10 * 60_000;
const defaultPermissionMode = 'acceptEdits';

const upsertStep = ({ steps, record }: { steps: StepRecord[]; record: StepRecord }) => {
	const existing = steps.findIndex((step) => step.id === record.id);

	if (existing === -1) {
		return [...steps, record];
	}

	return steps.map((step, index) => (index === existing ? record : step));
};

interface Params {
	cwd: string;
	planPath: string;
	driver: Driver;
	config: LightsoutConfig;
}

/**
 * v0 implement pipeline: clean-slate gate → feature-executor → verify gate
 * (with executor fix re-invocations). Every state transition is persisted to
 * the run manifest before the next action — a crash at any point leaves a
 * resumable, truthful record on disk.
 */
export const runImplementPipeline = async ({ cwd, planPath, driver, config }: Params): Promise<PipelineResult> => {
	let manifest = await createRun({ cwd, plan: planPath, driver: driver.name });

	const update = async (patch: Partial<RunManifest>) => {
		manifest = await writeRunManifest({ cwd, manifest: { ...manifest, ...patch } });
	};

	const setStep = async ({ record, patch }: { record: StepRecord; patch?: Partial<RunManifest> }) => {
		await update({ ...patch, currentStep: record.id, steps: upsertStep({ steps: manifest.steps, record }) });
	};

	const failRun = async ({ record, error }: { record: StepRecord; error: string }) => {
		await setStep({ record: { ...record, status: RunStatus.Failed, error }, patch: { status: RunStatus.Failed } });

		const failed: PipelineResult = { ok: false, manifest, error };

		return failed;
	};

	const runGates = async () => {
		const check = await runCommand({ command: config.scripts.check, cwd, timeoutMs: gateTimeoutMs });

		if (check.exitCode !== 0) {
			return `check failed (exit ${check.exitCode}):\n${check.stdout}\n${check.stderr}`;
		}

		const tests = await runCommand({ command: config.scripts.testUnit, cwd, timeoutMs: gateTimeoutMs });

		if (tests.exitCode !== 0) {
			return `test-unit failed (exit ${tests.exitCode}):\n${tests.stdout}\n${tests.stderr}`;
		}

		return undefined;
	};

	// --- Step: clean-slate (hard gate, no retries) ---
	const cleanSlate: StepRecord = { id: 'clean-slate', status: RunStatus.Running, attempts: 1 };

	await setStep({ record: cleanSlate, patch: { status: RunStatus.Running } });

	const cleanSlateError = await runGates();

	if (cleanSlateError) {
		return failRun({
			record: cleanSlate,
			error: `Codebase is not green before implementation — fix this first.\n${cleanSlateError}`,
		});
	}

	await setStep({ record: { ...cleanSlate, status: RunStatus.Passed } });

	// --- Step: implement ---
	const planContent = await readFile(join(cwd, planPath), 'utf8').catch(() => undefined);

	if (planContent === undefined) {
		return failRun({
			record: { id: 'implement', status: RunStatus.Running, attempts: 0 },
			error: `plan file not found: ${join(cwd, planPath)}`,
		});
	}

	const invokeExecutor = async ({ errorContext }: { errorContext?: string }) => {
		const invocation = buildFeatureExecutorInvocation({ planContent, errorContext });

		// Report-shape retries: a malformed payload is rejected by the contract
		// and the invocation retried — never hand-parsed around.
		let lastFailure = 'no attempts made';

		for (let attempt = 1; attempt <= maxReportAttempts; attempt += 1) {
			const result = await driver.invoke({
				prompt: invocation.prompt,
				systemPrompt: invocation.systemPrompt,
				model: config.model,
				permissionMode: config.permissionMode ?? defaultPermissionMode,
				cwd,
				timeoutMs: executorTimeoutMs,
			});

			const parsed = ImplementReport.safeParse(extractJsonReport({ text: result.text }));

			if (parsed.success) {
				return { report: parsed.data, failure: undefined };
			}

			lastFailure = `agent output did not match ImplementReport (exit ${result.exitCode}): ${parsed.error.message}`;
		}

		return { report: undefined, failure: lastFailure };
	};

	const implement: StepRecord = { id: 'implement', status: RunStatus.Running, attempts: 1 };

	await setStep({ record: implement });

	const { report, failure } = await invokeExecutor({});

	if (!report) {
		return failRun({ record: { ...implement, attempts: maxReportAttempts }, error: failure ?? 'unknown failure' });
	}

	if (report.status !== ImplementReportStatus.Complete) {
		return failRun({
			record: { ...implement, report },
			error: `executor terminated: ${report.status} — ${report.failures.join('; ')}`,
		});
	}

	await setStep({
		record: { ...implement, status: RunStatus.Passed, report },
		patch: { changedFiles: report.changedFiles.map((file) => file.path) },
	});

	// --- Step: verify (retry gate — executor re-invoked with error context) ---
	let verify: StepRecord = { id: 'verify', status: RunStatus.Running, attempts: 1 };

	await setStep({ record: verify });

	let verifyError = await runGates();

	for (let retry = 1; verifyError && retry <= maxVerifyRetries; retry += 1) {
		verify = { ...verify, attempts: verify.attempts + 1 };

		await setStep({ record: verify });

		const fix = await invokeExecutor({ errorContext: verifyError });

		if (fix.report) {
			const merged = new Set([...manifest.changedFiles, ...fix.report.changedFiles.map((file) => file.path)]);

			await setStep({ record: { ...verify, report: fix.report }, patch: { changedFiles: [...merged] } });
		}

		verifyError = await runGates();
	}

	if (verifyError) {
		return failRun({ record: verify, error: `verification still failing after retries:\n${verifyError}` });
	}

	await setStep({ record: { ...verify, status: RunStatus.Passed } });
	await update({ status: RunStatus.Passed, currentStep: null });

	const passed: PipelineResult = { ok: true, manifest };

	return passed;
};
