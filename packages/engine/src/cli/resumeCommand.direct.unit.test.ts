import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { resumeCommand } from '#src/cli/resumeCommand.ts';
import { type LightsoutConfig, PipelineKind, type RunManifest, RunStatus, WorktreeOwner } from '#src/contracts/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import type { QueueFailure } from '#src/queue/index.ts';
import { writeWorktreeRecord } from '#src/worktree/index.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { manifestOf, runId, setupResume } from '#tests/helpers/setupResume.ts';

// Mocked Imports
// -------------------------
// What this file pins is how resume continues a DIRECT run: which checkout each
// remaining step acts on, whether the worker is invoked again, and which dirty
// trees it refuses to commit. The worker spawns a harness, the commit writes git
// history and the ship tail leaves the machine — each covered by its own tests.
type DirectWorkParams = { cwd: string; ticketBody: string; ticketRef: string; existing?: RunManifest };
type CommitParams = { cwd: string; message: string; runDir: string; generated: string[] | undefined; onProgress: (message: string) => void };
type GuardParams = { cwd: string; config: LightsoutConfig; env: NodeJS.ProcessEnv; ticketRef?: string; onProgress?: (message: string) => void };
type ExitAfterImplementParams = {
	config: LightsoutConfig;
	cwd: string;
	result: PipelineResult;
	shipFlag: boolean;
	noShipFlag: boolean;
	env: NodeJS.ProcessEnv;
};

const mockRunDirectWork = jest.fn<(params: DirectWorkParams) => Promise<PipelineResult>>();

jest.mock('#src/direct/index.ts', () => ({ runDirectWork: (params: DirectWorkParams) => mockRunDirectWork(params) }));
// -------------------------
const mockCommitTicketWork = jest.fn<(params: CommitParams) => Promise<{ committed: boolean } | QueueFailure>>();

jest.mock('#src/queue/index.ts', () => ({
	...jest.requireActual<typeof import('#src/queue/index.ts')>('#src/queue/index.ts'),
	commitTicketWork: (params: CommitParams) => mockCommitTicketWork(params),
}));
// -------------------------
const mockRequireImplementLifecycle = jest.fn<(params: GuardParams) => Promise<string | undefined>>();

jest.mock('#src/ticketLifecycle/index.ts', () => ({
	...jest.requireActual<typeof import('#src/ticketLifecycle/index.ts')>('#src/ticketLifecycle/index.ts'),
	requireImplementLifecycle: (params: GuardParams) => mockRequireImplementLifecycle(params),
}));
// -------------------------
const mockExitAfterImplement = jest.fn<(params: ExitAfterImplementParams) => Promise<void>>();

jest.mock('#src/cli/common/utils/exitAfterImplement.ts', () => ({
	exitAfterImplement: (params: ExitAfterImplementParams) => mockExitAfterImplement(params),
}));
// -------------------------

/** The branch the seeded run was built on, and the one its ownership record is keyed by. */
const branch = 'lo-70-drain';

/** The ticket body frozen beside the run by the invocation that started it — the input a resume must not re-derive. */
const ticketBody = '# Drain the backlog\n\nBuild the thing.\n';

/** Where that frozen ticket sits, relative to the checkout the run's records live in. */
const frozenTicketPath = join('.lightsout', 'runs', runId, 'ticket.md');

/**
 * A parked direct run: its records in the checkout the command is launched
 * from, its work in a second checkout the manifest records as the workspace.
 *
 * `dirty` is what the workspace holds uncommitted when resume finds it, and
 * `recorded` is what the manifest already says the run itself touched — the two
 * sets the ownership guard compares its dirty tree against. `owned` records the
 * branch's worktree as one a standalone implementation run created, in both
 * checkouts, so the record is found whichever of them is asked.
 */
const setupDirectResume = async ({
	status,
	dirty,
	recorded = {},
	owned = false,
	withTicket = true,
	withTicketRef = true,
}: {
	status: RunStatus;
	/** Files left uncommitted in the workspace, by repo-relative name. */
	dirty?: Record<string, string>;
	/** What the manifest records as the run's own work: the files it changed, and the files already dirty when it started. */
	recorded?: { changedFiles?: string[]; baselineDirtyFiles?: string[] };
	/** Whether the branch carries an `Implement` worktree ownership record. */
	owned?: boolean;
	/** Whether the frozen ticket is still on disk beside the run; false leaves the recorded path pointing at nothing. */
	withTicket?: boolean;
	/** Whether the manifest recorded a ticket reference; false is a run started on a branch whose ticket the pattern never read. */
	withTicketRef?: boolean;
}) => {
	const { cwd: workspace } = setupBranchRepo({ branch, dirty });
	const seeded = setupResume({
		args: ['--run', runId],
		manifest: manifestOf({
			pipeline: PipelineKind.Direct,
			status,
			plan: frozenTicketPath,
			ticketRef: withTicketRef ? 'lo-70' : undefined,
			branch,
			workspace,
			changedFiles: recorded.changedFiles ?? [],
			baselineDirtyFiles: recorded.baselineDirtyFiles ?? [],
		}),
	});

	if (withTicket) {
		writeFileSync(join(seeded.cwd, frozenTicketPath), ticketBody);
	}

	if (owned) {
		await writeWorktreeRecord({ cwd: seeded.cwd, branch, owner: WorktreeOwner.Implement, worktreePath: workspace });
		await writeWorktreeRecord({ cwd: workspace, branch, owner: WorktreeOwner.Implement, worktreePath: workspace });
	}

	mockRequireImplementLifecycle.mockResolvedValue(undefined);
	mockRunDirectWork.mockResolvedValue({ ok: true, manifest: manifestOf({ pipeline: PipelineKind.Direct, status: RunStatus.Passed, workspace, branch }) });
	mockCommitTicketWork.mockResolvedValue({ committed: true });
	mockExitAfterImplement.mockResolvedValue(undefined);

	return { workspace, ...seeded };
};

describe('resumeCommand direct runs', () => {
	test('a failed direct run is continued here, keeping its run id and its frozen ticket', async () => {
		const { context, workspace, errors } = await setupDirectResume({ status: RunStatus.Failed });

		await resumeCommand(context);

		// the run is continued in the tree it recorded, under its own id, from the
		// ticket frozen beside it — never sent back to `implement-direct`
		expect(mockRunDirectWork).toHaveBeenCalledWith(expect.objectContaining({ cwd: workspace, ticketBody, existing: expect.objectContaining({ runId }) }));
		expect(errors).toStrictEqual([]);
	});

	test('a direct run that passed but never committed commits and ships without rebuilding', async () => {
		const { context, workspace } = await setupDirectResume({
			status: RunStatus.Passed,
			dirty: { 'feature.ts': 'export const feature = 1;\n' },
			recorded: { changedFiles: ['feature.ts'] },
		});

		await resumeCommand(context);

		// passed means the build and the gates are done, so only the commit and the
		// ship are left — re-invoking the worker would spend a model on finished work
		expect(mockRunDirectWork).not.toHaveBeenCalled();
		expect(mockCommitTicketWork).toHaveBeenCalledWith(expect.objectContaining({ cwd: workspace }));
		expect(mockExitAfterImplement).toHaveBeenCalledWith(expect.objectContaining({ cwd: workspace, result: expect.objectContaining({ ok: true }) }));
	});

	test('refuses to commit a checkout lightsout does not own when the user has edited it since the run parked', async () => {
		const { context, errors, exitCodes } = await setupDirectResume({
			status: RunStatus.Passed,
			dirty: { 'feature.ts': 'export const feature = 1;\n', 'stray.ts': 'export const stray = 1;\n' },
			recorded: { changedFiles: ['feature.ts'] },
		});

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		// the commit stages everything in the tree, so a file the user touched after
		// the run parked would ride into the ticket's pull request
		expect(errors.join('\n')).toContain('stray.ts');
		expect(mockCommitTicketWork).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test('commits an opted-out run whose only dirty files are its own work', async () => {
		const { context, workspace, errors } = await setupDirectResume({
			status: RunStatus.Passed,
			dirty: { 'feature.ts': 'export const feature = 1;\n', 'notes.md': '# scratch\n' },
			recorded: { changedFiles: ['feature.ts'], baselineDirtyFiles: ['notes.md'] },
		});

		await resumeCommand(context);

		// a parked run's tree is dirty by design — refusing every dirty tree would
		// make a run started with --no-worktree unresumable
		expect(mockCommitTicketWork).toHaveBeenCalledWith(expect.objectContaining({ cwd: workspace }));
		expect(errors).toStrictEqual([]);
	});

	test('skips the ownership guard entirely for a workspace lightsout created', async () => {
		const { context, workspace, errors } = await setupDirectResume({
			status: RunStatus.Passed,
			dirty: { 'stray.ts': 'export const stray = 1;\n' },
			owned: true,
		});

		await resumeCommand(context);

		// the tree was cut for this run and holds nothing else, so there is nothing
		// to compare the dirty set against and nothing the comparison could refuse
		expect(mockCommitTicketWork).toHaveBeenCalledWith(expect.objectContaining({ cwd: workspace }));
		expect(errors).toStrictEqual([]);
	});

	test('a direct run that already committed re-ships instead of being refused for an empty commit', async () => {
		const { context, workspace, errors } = await setupDirectResume({ status: RunStatus.Passed });

		await resumeCommand(context);

		// a clean workspace means the commit already landed and only the ship
		// failed, which is not the worker having changed nothing
		expect(mockCommitTicketWork).not.toHaveBeenCalled();
		expect(errors).toStrictEqual([]);
		expect(mockExitAfterImplement).toHaveBeenCalledWith(expect.objectContaining({ cwd: workspace, result: expect.objectContaining({ ok: true }) }));
	});

	test('a continued run that fails again leaves its tree uncommitted for the next resume', async () => {
		const { context, errors } = await setupDirectResume({ status: RunStatus.Failed, dirty: { 'feature.ts': 'export const feature = 1;\n' } });

		mockRunDirectWork.mockResolvedValue({
			ok: false,
			manifest: manifestOf({ pipeline: PipelineKind.Direct, status: RunStatus.Failed }),
			error: 'tsc: 3 errors',
		});

		await resumeCommand(context);

		// the same rule a first run follows: a build that did not pass is never
		// committed, so the partial work stays in the tree for the next attempt
		expect(mockCommitTicketWork).not.toHaveBeenCalled();
		expect(mockExitAfterImplement).toHaveBeenCalledWith(expect.objectContaining({ result: expect.objectContaining({ ok: false }) }));
		// what the reader is told is why the build stopped, not a commit refusal
		expect(errors.join('\n')).toContain('tsc: 3 errors');
	});

	test('a run that recorded no reference is committed under the branch it was built on', async () => {
		const { context } = await setupDirectResume({
			status: RunStatus.Passed,
			dirty: { 'feature.ts': 'export const feature = 1;\n' },
			recorded: { changedFiles: ['feature.ts'] },
			withTicketRef: false,
		});

		await resumeCommand(context);

		// the commit subject is what the pull request is titled from, so a run
		// whose branch carried no ticket the pattern read is still named after
		// something a human recognises rather than a placeholder
		expect(mockCommitTicketWork).toHaveBeenCalledWith(expect.objectContaining({ message: 'lo-70-drain Drain the backlog' }));
	});

	test('a direct run whose frozen ticket has gone names the path and stops', async () => {
		const { context, errors, exitCodes } = await setupDirectResume({ status: RunStatus.Failed, withTicket: false });

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors.join('\n')).toContain(frozenTicketPath);
		expect(mockRunDirectWork).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});
});
