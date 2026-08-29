import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { toRepoRelativePath } from '#src/common/utils/toRepoRelativePath.ts';
import { type LightsoutConfig, type PipelineKind, type RunManifest, RunStatus } from '#src/contracts/index.ts';
import { getRunDir } from '#src/runState/common/paths/getRunDir.ts';
import { writeRunManifest } from '#src/runState/writeRunManifest.ts';

interface Params {
	cwd: string;
	/** Pre-minted run id (the lock is taken under it before anything is written). Fresh UUID when omitted. */
	runId?: string;
	/** Plan path as the caller named it, cwd-relative or absolute — recorded cwd-relative either way. */
	plan: string;
	/** Owning pipeline, stamped for resume routing. */
	pipeline?: PipelineKind;
	/** The ticket this run builds, e.g. 'LO-70' — recorded on the manifest. Absent on a run started from a plan. */
	ticketRef?: string;
	/** Optional overview plan path (high-level context for a phased plan), cwd-relative or absolute — recorded cwd-relative either way. */
	overview?: string;
	/** The coordinator's run id, when this run is one phase of a sequence — the one moment the parent link is known, so the one place it is written. */
	parentRunId?: string;
	/** The driver name the run was started with, persisted as the manifest's `harness` field. */
	driver: string;
	/** Resolved config, snapshotted into the manifest as the run's permanent settings record. */
	config?: LightsoutConfig;
	/** Git-dirty paths at run start — the subtraction baseline for changed-file attribution. */
	baselineDirtyFiles?: string[];
}

/**
 * Create a new run: fresh id, run directory, and initial manifest on disk.
 *
 * The plan paths are recorded cwd-relative whatever form the caller used: the
 * manifest's contract is repo-relative, every reader joins the record onto the
 * repo, and an absolute `--plan` written as given would be joined onto it too
 * and read back as a missing file. Enforced here, at the one place a manifest
 * is born, rather than by each pipeline remembering to.
 */
export const createRun = async ({
	cwd,
	runId,
	plan,
	pipeline,
	ticketRef,
	overview,
	parentRunId,
	driver,
	config,
	baselineDirtyFiles,
}: Params): Promise<RunManifest> => {
	const now = new Date().toISOString();
	const manifest: RunManifest = {
		runId: runId ?? randomUUID(),
		createdAt: now,
		updatedAt: now,
		plan: toRepoRelativePath({ cwd, path: plan }),
		pipeline,
		ticketRef,
		overview: overview === undefined ? undefined : toRepoRelativePath({ cwd, path: overview }),
		parentRunId,
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
