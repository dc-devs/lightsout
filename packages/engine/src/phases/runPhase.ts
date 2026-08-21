import { dirname, join } from 'node:path';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { type LightsoutConfig, PhaseReport, type RunManifest, RunStatus, type RunUsage, type StepRecord } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { type PipelineResult, runImplementPipeline } from '#src/pipeline/index.ts';
import { RunLockError, readRunManifest, writeRunManifest } from '#src/runState/index.ts';

/** Replace one step record, merge the coordinator's own fields, and persist — the loop's single write path. */
const persistStep = ({
	cwd,
	manifest,
	index,
	record,
	patch,
}: {
	cwd: string;
	manifest: RunManifest;
	index: number;
	record: StepRecord;
	patch?: Partial<RunManifest>;
}) => {
	const steps = manifest.steps.map((step, position) => (position === index ? record : step));

	return writeRunManifest({ cwd, manifest: { ...manifest, ...patch, steps } });
};

/** What a finished phase leaves on its step: the child's own verdict, the run that reached it, and its real working time. */
const recordFromChild = ({ step, childResult }: { step: StepRecord; childResult: PipelineResult }) => ({
	...step,
	status: childResult.manifest.status,
	attempts: step.attempts + 1,
	durationMs: childResult.manifest.steps.reduce((total, childStep) => total + (childStep.durationMs ?? 0), 0),
	report: { runId: childResult.manifest.runId },
	error: childResult.error,
});

/** Field-wise sum of a child run's usage into the sequence total — an absent child usage leaves the total untouched. */
const addUsage = ({ total, child }: { total?: RunUsage; child?: RunUsage }) => {
	if (!child) {
		return total;
	}

	if (!total) {
		return child;
	}

	return {
		invocations: total.invocations + child.invocations,
		inputTokens: total.inputTokens + child.inputTokens,
		outputTokens: total.outputTokens + child.outputTokens,
		cacheReadTokens: total.cacheReadTokens + child.cacheReadTokens,
		cacheCreationTokens: total.cacheCreationTokens + child.cacheCreationTokens,
		costUsd: total.costUsd + child.costUsd,
	};
};

/**
 * The child run a step already names, when there is one — a step that names a
 * run may be a crash between the child finishing and the coordinator recording
 * it, and the child's own manifest settles which.
 */
const readRecordedChild = async ({ cwd, step }: { cwd: string; step: StepRecord }) => {
	const recorded = PhaseReport.safeParse(step.report);

	return recorded.success ? await readRunManifest({ cwd, runId: recorded.data.runId }).catch(() => undefined) : undefined;
};

/**
 * The per-phase run itself, with the one throw the coordinator must not swallow
 * kept separate: every throw becomes this phase's recorded failure except a
 * lock it could not take, which means nothing ran.
 *
 * @throws {RunLockError} When the phase cannot take the repo lock.
 */
const runChild = async (params: Parameters<typeof runImplementPipeline>[0]): Promise<PipelineResult | { failure: string }> => {
	let result: PipelineResult | { failure: string };

	try {
		result = await runImplementPipeline(params);
	} catch (error) {
		if (error instanceof RunLockError) {
			throw error;
		}

		result = { failure: messageOf({ error }) };
	}

	return result;
};

interface PhaseParams {
	cwd: string;
	driver: Driver;
	config: LightsoutConfig;
	manifest: RunManifest;
	index: number;
	step: StepRecord;
	total: number;
	skipRefactor?: boolean;
	onProgress?: (message: string) => void;
}

/**
 * One phase, from its resume check to its recorded outcome: the manifest it
 * leaves behind, plus the result that stops the whole sequence when the phase
 * ended short of passing. No result means carry on to the next phase.
 *
 * @throws {RunLockError} When the phase cannot take the repo lock — nothing ran, so the sequence stays exactly resumable.
 */
export const runPhase = async ({
	cwd,
	driver,
	config,
	manifest,
	index,
	step,
	total,
	skipRefactor,
	onProgress,
}: PhaseParams): Promise<{ manifest: RunManifest; result?: PipelineResult }> => {
	onProgress?.(`phase ${index + 1}/${total}: ${step.id}`);

	const childManifest = await readRecordedChild({ cwd, step });

	if (childManifest?.status === RunStatus.Passed) {
		return { manifest: await persistStep({ cwd, manifest, index, record: { ...step, status: RunStatus.Passed } }) };
	}

	let current = await persistStep({
		cwd,
		manifest,
		index,
		record: { ...step, status: RunStatus.Running, error: undefined },
		patch: { status: RunStatus.Running, currentStep: step.id },
	});

	const childResult = await runChild({
		cwd,
		driver,
		config,
		planPath: join(dirname(current.plan), step.id),
		overviewPath: current.plan,
		existing: childManifest,
		skipRefactor,
		onProgress,
	});

	if ('failure' in childResult) {
		current = await persistStep({
			cwd,
			manifest: current,
			index,
			record: { ...step, status: RunStatus.Failed, error: childResult.failure },
			patch: { status: RunStatus.Failed },
		});

		return { manifest: current, result: { ok: false, manifest: current, error: childResult.failure } };
	}

	const child = childResult.manifest;

	current = await persistStep({
		cwd,
		manifest: current,
		index,
		record: recordFromChild({ step, childResult }),
		patch: {
			status: childResult.ok ? RunStatus.Running : child.status,
			changedFiles: [...new Set([...current.changedFiles, ...child.changedFiles])],
			usage: addUsage({ total: current.usage, child: child.usage }),
		},
	});

	if (childResult.ok) {
		return { manifest: current };
	}

	const stopped = `phase ${index + 1}/${total} (${step.id}) ended ${child.status} — resume with: lightsout resume --run ${current.runId}`;

	return { manifest: current, result: { ok: false, manifest: current, error: childResult.error ? `${stopped}\n${childResult.error}` : stopped } };
};
