import { dirname, join } from 'node:path';
import type { ActivityLevel } from '#src/activity/common/types/ActivityLevel.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { ActivityLevelKind } from '#src/contracts/activity/ActivityLevelKind.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { PhaseReport } from '#src/contracts/run/PhaseReport.ts';
import type { RunManifest } from '#src/contracts/run/RunManifest.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import type { RunUsage } from '#src/contracts/run/RunUsage.ts';
import type { StepRecord } from '#src/contracts/run/StepRecord.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import type { PipelineResult } from '#src/pipeline/PipelineResult.ts';
import { runImplementPipeline } from '#src/pipeline/runImplementPipeline.ts';
import { RunLockError } from '#src/runState/lock/RunLockError.ts';
import { readRunManifest } from '#src/runState/readRunManifest.ts';
import { writeRunManifest } from '#src/runState/writeRunManifest.ts';

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

/**
 * What the coordinator records once a phase's child run has settled: the step
 * merged into the coordinator's manifest, plus the result that stops the whole
 * sequence when the child ended short of passing.
 */
const recordFinishedChild = async ({
	cwd,
	manifest,
	index,
	step,
	total,
	childResult,
}: {
	cwd: string;
	manifest: RunManifest;
	index: number;
	step: StepRecord;
	total: number;
	childResult: PipelineResult;
}) => {
	const child = childResult.manifest;
	const current = await persistStep({
		cwd,
		manifest,
		index,
		record: recordFromChild({ step, childResult }),
		patch: {
			status: childResult.ok ? RunStatus.Running : child.status,
			changedFiles: [...new Set([...manifest.changedFiles, ...child.changedFiles])],
			// Each phase's entry carries its own child run id, and a resumed phase that
			// skips a passed child returns before this patch, so concatenating cannot double one.
			commits: [...manifest.commits, ...child.commits],
			usage: addUsage({ total: manifest.usage, child: child.usage }),
		},
	});

	if (childResult.ok) {
		return { manifest: current };
	}

	const stopped = `phase ${index + 1}/${total} (${step.id}) ended ${child.status} — resume with: lightsout resume --run ${current.runId}`;

	return { manifest: current, result: { ok: false, manifest: current, error: childResult.error ? `${stopped}\n${childResult.error}` : stopped } };
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
	/** Whether the SEQUENCE this phase belongs to was resumed. Forwarded to the child's pipeline call, because a phase that had not started when the sequence parked has no child manifest of its own to prove it from. */
	resumed: boolean;
	/** The command-run level this phase's own pass level is opened under. Absent wherever no run is being recorded. */
	level?: ActivityLevel;
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
	resumed,
	level,
	onProgress,
}: PhaseParams): Promise<{ manifest: RunManifest; result?: PipelineResult }> => {
	// One string for the narration and the recorded label alike, so the report
	// and the live progress line can never name a phase differently.
	const label = `phase ${index + 1}/${total}: ${step.id}`;

	onProgress?.(label);

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

	// Opened only below the already-passed guard, so a phase a resume finds
	// finished writes no zero-length row for work no process did, and closed in a
	// `finally` so a lock the child could not take still ends the level.
	const pass = level?.open({ level: ActivityLevelKind.Pass, label });
	let outcome: RunStatus = RunStatus.Failed;

	try {
		const childResult = await runChild({
			cwd,
			driver,
			config,
			planPath: join(dirname(current.plan), step.id),
			overviewPath: current.plan,
			parentRunId: current.runId,
			existing: childManifest,
			// The sequence's own owned set, taken before the sequence began, is the only
			// set the unowned-edits guard can mean anything against: a phase that never
			// started would otherwise snapshot a tree somebody may have sat in for days
			// and call every edit in it its own.
			inheritedBaseline: resumed && childManifest === undefined ? [...current.changedFiles, ...current.baselineDirtyFiles] : undefined,
			skipRefactor,
			level: pass,
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

		outcome = childResult.manifest.status;

		return await recordFinishedChild({ cwd, manifest: current, index, step, total, childResult });
	} finally {
		pass?.close({ outcome });
	}
};
