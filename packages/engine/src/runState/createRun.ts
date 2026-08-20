import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { type LightsoutConfig, type RunManifest, RunStatus } from '#src/contracts/index.ts';
import { getRunDir } from '#src/runState/common/paths/getRunDir.ts';
import { writeRunManifest } from '#src/runState/writeRunManifest.ts';

interface Params {
	cwd: string;
	/** Pre-minted run id (the lock is taken under it before anything is written). Fresh UUID when omitted. */
	runId?: string;
	plan: string;
	/** Owning pipeline, stamped for resume routing ('implement' | 'refactor'). */
	pipeline?: string;
	/** Optional overview plan path (high-level context for a phased plan). */
	overview?: string;
	/** The driver name the run was started with, persisted as the manifest's `harness` field. */
	driver: string;
	/** Resolved config, snapshotted into the manifest as the run's permanent settings record. */
	config?: LightsoutConfig;
	/** Git-dirty paths at run start — the subtraction baseline for changed-file attribution. */
	baselineDirtyFiles?: string[];
}

/** Create a new run: fresh id, run directory, and initial manifest on disk. */
export const createRun = async ({ cwd, runId, plan, pipeline, overview, driver, config, baselineDirtyFiles }: Params): Promise<RunManifest> => {
	const now = new Date().toISOString();
	const manifest: RunManifest = {
		runId: runId ?? randomUUID(),
		createdAt: now,
		updatedAt: now,
		plan,
		pipeline,
		overview,
		harness: driver,
		config,
		status: RunStatus.Pending,
		currentStep: null,
		steps: [],
		changedFiles: [],
		packages: [],
		baselineDirtyFiles: baselineDirtyFiles ?? [],
		testSubjects: [],
		unreachableChangedFiles: [],
	};

	await mkdir(getRunDir({ cwd, runId: manifest.runId }), { recursive: true });

	return writeRunManifest({ cwd, manifest });
};
