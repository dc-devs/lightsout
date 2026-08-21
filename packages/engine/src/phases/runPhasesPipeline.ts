import { type LightsoutConfig, type RunManifest, RunStatus } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { initializeSequence } from '#src/phases/initializeSequence.ts';
import { runPhase } from '#src/phases/runPhase.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import { writeRunManifest } from '#src/runState/index.ts';

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

		const phase = await runPhase({ cwd, driver, config, manifest, index, step, total, skipRefactor, onProgress });

		manifest = phase.manifest;

		if (phase.result) {
			return phase.result;
		}
	}

	manifest = await writeRunManifest({ cwd, manifest: { ...manifest, status: RunStatus.Passed, currentStep: null } });

	return { ok: true, manifest };
};
