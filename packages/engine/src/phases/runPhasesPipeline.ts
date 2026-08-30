import { type LightsoutConfig, type RunManifest, RunStatus } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { initializeSequence } from '#src/phases/initializeSequence.ts';
import { runPhase } from '#src/phases/runPhase.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import { createProgressSink, writeRunManifest } from '#src/runState/index.ts';

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
	/** Resolved before the run starts: a passing sequence will ship this branch. Stamped on the COORDINATOR only — a phase's child run must never draw a ship row it can never fill. */
	willShip?: boolean;
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
	willShip,
	onProgress,
}: Params): Promise<PipelineResult> => {
	const initialized = await initializeSequence({ cwd, driver, config, overviewPath, startPhase, existing, willShip });

	let manifest = initialized.manifest;

	// The coordinator holds no RunState, so the tee that persists a run's
	// narration does not reach it — and a bare `--watch` shows the coordinator
	// in the gap between phases, which is exactly where a reader looks. Wrapping
	// its one callback gives the coordinator a `now` line of its own.
	const sink = createProgressSink({ cwd, runId: manifest.runId });
	const narrate = (message: string) => {
		sink(message);
		onProgress?.(message);
	};
	const total = manifest.steps.length;

	for (const [index, step] of manifest.steps.entries()) {
		if (step.status === RunStatus.Passed) {
			continue;
		}

		const phase = await runPhase({ cwd, driver, config, manifest, index, step, total, skipRefactor, onProgress: narrate });

		manifest = phase.manifest;

		if (phase.result) {
			return phase.result;
		}
	}

	manifest = await writeRunManifest({ cwd, manifest: { ...manifest, status: RunStatus.Passed, currentStep: null } });

	return { ok: true, manifest };
};
