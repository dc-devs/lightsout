import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readGitCurrentBranch } from '#src/common/git/readGitCurrentBranch.ts';
import { toRepoRelativePath } from '#src/common/utils/toRepoRelativePath.ts';
import { type LightsoutConfig, type PipelineKind, type RunManifest, RunStatus } from '#src/contracts/index.ts';
import { planNameFromPath } from '#src/plan/index.ts';
import { runDirectoryIndex } from '#src/runState/common/constants/runDirectoryIndex.ts';
import { resolveNewRunDir } from '#src/runState/common/paths/resolveNewRunDir.ts';
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
	/** Resolved before the run starts: a passing run will ship this branch. Omitted by every pipeline that resolves no ship intent. */
	willShip?: boolean;
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
	willShip,
}: Params): Promise<RunManifest> => {
	const now = new Date().toISOString();
	// One string answers both fields, so the name can never claim a plan the
	// recorded path does not sit in.
	const recordedPlan = toRepoRelativePath({ cwd, path: plan });
	const planName = await planNameFromPath({ cwd, planPath: recordedPlan });
	const branch = await readGitCurrentBranch({ cwd });
	const manifest: RunManifest = {
		runId: runId ?? randomUUID(),
		createdAt: now,
		updatedAt: now,
		plan: recordedPlan,
		planName,
		pipeline,
		ticketRef,
		overview: overview === undefined ? undefined : toRepoRelativePath({ cwd, path: overview }),
		parentRunId,
		harness: driver,
		config,
		branch,
		// Absolute, because the reader that wants it is standing in another checkout
		// and has nothing to join a relative path onto. Written from what this
		// function already holds rather than threaded down from three pipeline entry
		// points: `cwd` IS the checkout the run's work happens in.
		workspace: resolve(cwd),
		willShip,
		status: RunStatus.Pending,
		currentStep: null,
		steps: [],
		changedFiles: [],
		packages: [],
		baselineDirtyFiles: baselineDirtyFiles ?? [],
		testSubjects: [],
		acceptanceTests: [],
		approvedTests: [],
		unreachableChangedFiles: [],
		coverageExcludedChangedFiles: [],
	};

	// `ticketRef` is set by exactly one pipeline — direct — and a direct run of a
	// ticket is built on that ticket's branch, which is the ticket folder's name
	// by construction. A run with no ticket to file under lands in the command's
	// own folder instead.
	const runDir = await resolveNewRunDir({
		cwd,
		planName,
		ticketBranch: planName === undefined && ticketRef !== undefined ? branch : undefined,
		pipeline,
		runId: manifest.runId,
	});

	// The order is load-bearing: `writeRunManifest` resolves its path through a
	// lookup that throws for a run the index has never seen, so recording after
	// the write would fail every run at creation.
	await mkdir(runDir, { recursive: true });
	runDirectoryIndex.record({ cwd, runId: manifest.runId, runDir });

	return writeRunManifest({ cwd, manifest });
};
