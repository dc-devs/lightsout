import { execSync } from 'node:child_process';
import { type LightsoutConfig, PlanProgress, RunManifest, RunStatus, WorkOrderMode, type WorktreeOwner } from '#src/contracts/index.ts';
import { writeWorktreeRecord } from '#src/worktree/index.ts';
import { seedRunFolder } from '#tests/helpers/seedRunFolder.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { writeRepoFile } from '#tests/helpers/writeRepoFile.ts';

/** The ticket folder's name, which is also the branch every plan below implements on. */
export const ticketBranch = 'lo-152-commit';
export const planId = '001-one-commit-behaviour';
export const runId = 'run-1234-abcd';
export const planFolder = `.lightsout/tickets/${ticketBranch}/plans/${planId}`;
/** What a run with no ticket record on disk is addressed by: the branch's ticket reference and the plan id. */
export const plainSubject = `lo-152 ${planId}`;

/** What `git rev-parse HEAD` answers in a checkout — read for real, so a recorded sha can be compared with the commit that was made. */
export const headCommitOf = ({ cwd }: { cwd: string }) => execSync('git rev-parse HEAD', { cwd }).toString().trim();

export const configOf = ({ generated }: { generated?: string[] }): LightsoutConfig => ({
	gates: { check: 'true', test: 'true', 'test-coverage': false },
	...(generated === undefined ? {} : { generated }),
});

/** One ticket's record as it sits on disk: the reference and the plan title a commit subject is addressed by. */
const ticketRecordOf = ({ branch }: { branch: string }) =>
	JSON.stringify({
		schemaVersion: 1,
		ticketRef: 'LO-152',
		branch,
		mode: WorkOrderMode.SinglePlan,
		plans: [{ id: planId, title: 'One commit behaviour', progress: PlanProgress.Implementing, createdAt: '2026-01-01T00:00:00.000Z' }],
		history: [],
	});

/** A manifest as a run carries one, minimal but for the four fields the commit step reads. */
export const manifestOf = ({ plan, changedFiles, branch }: { plan: string; changedFiles: string[]; branch?: string }) =>
	RunManifest.parse({
		runId,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:03.000Z',
		plan,
		harness: 'claude-code',
		status: RunStatus.Running,
		currentStep: null,
		steps: [],
		branch,
		changedFiles,
	});

/**
 * A stand-in for the run the commit step is handed: the structural slice it
 * declares, holding the manifest in memory so a case reads back what was
 * patched.
 */
export const createCommitRun = ({ cwd, manifest, config }: { cwd: string; manifest: RunManifest; config: LightsoutConfig }) => {
	let current = manifest;
	const progress: string[] = [];

	return {
		progress,
		manifestNow: () => current,
		run: {
			cwd,
			config,
			current: () => current,
			progress: (message: string) => {
				progress.push(message);
			},
			update: async ({ patch }: { patch: Partial<RunManifest> }) => {
				current = { ...current, ...patch };
			},
		},
	};
};

/**
 * A real repository a run built in: run state gitignored the way a consumer
 * repo ignores it, the ticket's plan folder under it, and whatever the run left
 * in the tree.
 *
 * Git stays real in every case built on this — the commit, the staging and the
 * tree reads are what the commit step is about. A case that needs git to stop
 * answering stubs that one read in its own file.
 */
export const setupCommitRun = async ({
	branch = ticketBranch,
	dirty = {},
	changedFiles = [],
	plan = `${planFolder}/plan.md`,
	record,
	generated,
	owner,
	branchOnManifest = true,
	detached = false,
}: {
	/** Repo-relative files left uncommitted — what the run's work looks like in the tree. */
	dirty?: Record<string, string>;
	/** The manifest's own changed-file list, which is what tells 'changed nothing' from 'already committed'. */
	changedFiles?: string[];
	branch?: string;
	/** Where the manifest says its plan is, repo-relative. */
	plan?: string;
	/** A ticket record beside the plan folders: one that parses, or a `ticket.json` that is not a record at all. */
	record?: 'valid' | 'corrupt';
	generated?: string[];
	/** Recorded owner of a worktree lightsout cut for this branch. Omitted for a checkout a person chose themselves. */
	owner?: WorktreeOwner;
	/** Whether the manifest records the branch it built on. A run that started on a detached HEAD records none. */
	branchOnManifest?: boolean;
	/** Whether the checkout stands on a commit rather than on a branch, which is where every branch read answers nothing. */
	detached?: boolean;
} = {}) => {
	const { cwd } = setupBranchRepo({ branch });

	writeRepoFile({ cwd, path: '.gitignore', content: '.lightsout/\n' });
	execSync('git add -A && git commit -qm ignore', { cwd, stdio: 'ignore' });
	writeRepoFile({ cwd, path: `${planFolder}/plan.md`, content: '# One commit behaviour\n' });
	writeRepoFile({ cwd, path: `${planFolder}/phase2-activity-record.md`, content: '# Phase 2\n' });

	if (record !== undefined) {
		writeRepoFile({
			cwd,
			path: `.lightsout/tickets/${branch}/ticket.json`,
			content: record === 'valid' ? ticketRecordOf({ branch }) : '{ this is not a ticket record',
		});
	}

	if (owner !== undefined) {
		await writeWorktreeRecord({ cwd, branch, owner, worktreePath: cwd });
	}

	if (detached) {
		execSync('git checkout -q --detach', { cwd, stdio: 'ignore' });
	}

	for (const [path, content] of Object.entries(dirty)) {
		writeRepoFile({ cwd, path, content });
	}

	// A real run's folder exists before the run starts, and the commit step looks
	// its directory up by run id — so the fixture has to leave one behind.
	seedRunFolder({ cwd, runId });

	const manifest = manifestOf({ plan, changedFiles, branch: branchOnManifest ? branch : undefined });

	return { cwd, ...createCommitRun({ cwd, manifest, config: configOf({ generated }) }) };
};
