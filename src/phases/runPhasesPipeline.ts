import { dirname, join } from 'node:path';
import { messageOf } from '@/common/utils/messageOf';
import { type LightsoutConfig, PhaseReport, type RunManifest, RunStatus, type RunUsage, type StepRecord } from '@/contracts';
import type { Driver } from '@/drivers';
import { initializeSequence } from '@/phases/initializeSequence';
import { type PipelineResult, runImplementPipeline } from '@/pipeline';
import { RunLockError, readRunManifest, writeRunManifest } from '@/runState';

interface Params {
	cwd: string;
	driver: Driver;
	config: LightsoutConfig;
	/** Overview path for a fresh sequence (cwd-relative or absolute). Ignored when resuming (the manifest owns it). */
	overviewPath?: string;
	/** 1-based phase a fresh sequence starts from; earlier phases are recorded as passed outside the sequence. Default 1. */
	startPhase?: number;
	/** Resume: an existing coordinator manifest — phases already passed are skipped. */
	existing?: RunManifest;
	skipRefactor?: boolean;
	onProgress?: (message: string) => void;
}

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
 * Run every phase of a phased plan, in the overview's written order, as its own
 * per-phase run.
 *
 * The coordinator keeps its own run state — one step record per phase — and
 * takes NO repo run lock of its own: each per-phase run acquires and releases
 * `.lightsout/lock.json` itself, and a lock held across phases would deadlock
 * the coordinator's own children. Concurrent-start protection comes from the
 * child's lock while a phase runs, plus the fresh-start guard that refuses a
 * second sequence for an overview that already has an unfinished one.
 *
 * The first phase that ends short of passing stops the whole sequence: later
 * phases build on earlier ones, so a predictable stop beats a clever guess at
 * independence. One `lightsout resume --run <id>` continues from that spot.
 *
 * @throws {RunLockError} When a phase cannot take the repo lock — nothing ran, so the sequence stays exactly resumable.
 */
export const runPhasesPipeline = async ({
	cwd,
	driver,
	config,
	overviewPath,
	startPhase,
	existing,
	skipRefactor,
	onProgress,
}: Params): Promise<PipelineResult> => {
	const initialized = await initializeSequence({ cwd, driver, config, overviewPath, startPhase, existing });

	let manifest = initialized.manifest;

	const total = manifest.steps.length;

	for (const [index, step] of manifest.steps.entries()) {
		if (step.status === RunStatus.Passed) {
			continue;
		}

		const planPath = join(dirname(manifest.plan), step.id);

		onProgress?.(`phase ${index + 1}/${total}: ${step.id}`);

		// A step that already names a child run may be a crash between the child
		// finishing and the coordinator recording it — the child's own manifest
		// settles which, and a passed child is never re-bought.
		const recorded = PhaseReport.safeParse(step.report);
		const childManifest = recorded.success ? await readRunManifest({ cwd, runId: recorded.data.runId }).catch(() => undefined) : undefined;

		if (childManifest?.status === RunStatus.Passed) {
			manifest = await persistStep({ cwd, manifest, index, record: { ...step, status: RunStatus.Passed } });

			continue;
		}

		manifest = await persistStep({
			cwd,
			manifest,
			index,
			record: { ...step, status: RunStatus.Running, error: undefined },
			patch: { status: RunStatus.Running, currentStep: step.id },
		});

		let childResult: PipelineResult;

		try {
			childResult = await runImplementPipeline({
				cwd,
				driver,
				config,
				planPath,
				overviewPath: manifest.plan,
				existing: childManifest,
				skipRefactor,
				onProgress,
			});
		} catch (error) {
			if (error instanceof RunLockError) {
				throw error;
			}

			const message = messageOf({ error });

			manifest = await persistStep({
				cwd,
				manifest,
				index,
				record: { ...step, status: RunStatus.Failed, error: message },
				patch: { status: RunStatus.Failed },
			});

			return { ok: false, manifest, error: message };
		}

		const child = childResult.manifest;

		manifest = await persistStep({
			cwd,
			manifest,
			index,
			record: recordFromChild({ step, childResult }),
			patch: {
				status: childResult.ok ? RunStatus.Running : child.status,
				changedFiles: [...new Set([...manifest.changedFiles, ...child.changedFiles])],
				usage: addUsage({ total: manifest.usage, child: child.usage }),
			},
		});

		if (!childResult.ok) {
			const stopped = `phase ${index + 1}/${total} (${step.id}) ended ${child.status} — resume with: lightsout resume --run ${manifest.runId}`;

			return { ok: false, manifest, error: childResult.error ? `${stopped}\n${childResult.error}` : stopped };
		}
	}

	manifest = await writeRunManifest({ cwd, manifest: { ...manifest, status: RunStatus.Passed, currentStep: null } });

	return { ok: true, manifest };
};
