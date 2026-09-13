import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { implementCommand } from '#src/cli/implementCommand.ts';
import { WorktreeOwner } from '#src/contracts/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import { readWorktreeRecord, resolveWorktreePath, writeWorktreeRecord } from '#src/worktree/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// Mocked Imports
// -------------------------
// The same seams the sibling worktree suite doubles, and only those: the temp
// repo has no remote, and git cannot cut a tree for it. The branch derivation,
// the workspace resolution, the ticket-branch preparation, the ownership
// records, the run lock and the input copy all run for real — which branch a
// plan address lands on and which plan folder reaches the workspace are the
// claims here.
interface CreateWorktreeParams {
	cwd: string;
	branch: string;
	startPoint: string;
	setup?: string;
	owner: WorktreeOwner;
	reuseExisting: boolean;
	onProgress?: (message: string) => void;
}

const mockCreateWorktree = jest.fn<(params: CreateWorktreeParams) => Promise<string | { error: string }>>();
const mockFetchDefaultBranch = jest.fn<(params: { cwd: string }) => Promise<string | { error: string }>>();
const mockReadBranchWorktree = jest.fn<(params: { cwd: string; branch: string }) => Promise<string | undefined>>();

jest.mock('#src/worktree/index.ts', () => ({
	...jest.requireActual<typeof import('#src/worktree/index.ts')>('#src/worktree/index.ts'),
	createWorktree: (params: CreateWorktreeParams) => mockCreateWorktree(params),
	fetchDefaultBranch: (params: { cwd: string }) => mockFetchDefaultBranch(params),
	readBranchWorktree: (params: { cwd: string; branch: string }) => mockReadBranchWorktree(params),
}));
// -------------------------
const mockRequireImplementLifecycle = jest.fn<(params: { cwd: string }) => Promise<string | undefined>>();

jest.mock('#src/ticketLifecycle/index.ts', () => ({
	...jest.requireActual<typeof import('#src/ticketLifecycle/index.ts')>('#src/ticketLifecycle/index.ts'),
	requireImplementLifecycle: (params: { cwd: string }) => mockRequireImplementLifecycle(params),
}));
// -------------------------
const mockRunPipelineOrFailFast = jest.fn<(params: { cwd: string; planPath: string }) => Promise<PipelineResult>>();

jest.mock('#src/cli/common/utils/runPipelineOrFailFast.ts', () => ({
	runPipelineOrFailFast: (params: { cwd: string; planPath: string }) => mockRunPipelineOrFailFast(params),
}));
// -------------------------
// The ship tail and the report card both read a run directory no mocked
// pipeline ever wrote, and neither is what these cases are about.
const mockPrintResult = jest.fn<(params: { result: PipelineResult; cwd: string }) => Promise<void>>();

jest.mock('#src/cli/common/render/printResult.ts', () => ({
	printResult: (params: { result: PipelineResult; cwd: string }) => mockPrintResult(params),
}));
// -------------------------
const mockExitAfterImplement = jest.fn<(params: { cwd: string }) => Promise<void>>();

jest.mock('#src/cli/common/utils/exitAfterImplement.ts', () => ({
	exitAfterImplement: (params: { cwd: string }) => mockExitAfterImplement(params),
}));
// -------------------------

/** The ticket folder two plans of one ticket share, and the branch its name yields. */
const ticketBranch = 'lo-7-search';
const ticketFolder = join('.lightsout', 'plans', ticketBranch);
const laterPlanFolder = join(ticketFolder, '002-ranking');
const earlierPlanFolder = join(ticketFolder, '001-basics');

/** A plan folder named for its branch alone — what every plan carried before addresses existed. */
const legacyBranch = 'lo-9-legacy-plan';
const legacyPlanFolder = join('.lightsout', 'plans', legacyBranch);

const planBody = '# Plan: rank the results\n';
const earlierPlanBody = '# Plan: the basics, graded in this tree\n';
const pinnedCommit = '0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d';

/** A run that passed. Nothing downstream of the pipeline is real here, so the result only has to be the same object each step is handed. */
const passedResult = { ok: true, manifest: { runId: 'aaaaaaaa-1111-2222-3333-444444444444' } } as unknown as PipelineResult;

/**
 * A real consumer repo holding one plan folder of a ticket, run against the
 * tree standing — or not standing — at the ticket branch's own worktree path.
 *
 * `standing` writes the ownership record a tree at that path carries and makes
 * the directory, so the branch is held; `heldBy` plants a live run lock in it,
 * this process's own pid being the one lock a test can prove alive. With
 * neither, nothing holds the branch and the run cuts a tree — a directory
 * already holding an earlier plan of the same ticket, which is what a tree the
 * ticket's first plan was built in looks like.
 */
const setupTicketRun = async ({
	planFolder = laterPlanFolder,
	branch = ticketBranch,
	standing,
	heldBy,
}: {
	planFolder?: string;
	branch?: string;
	standing?: WorktreeOwner;
	heldBy?: string;
} = {}) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo();
	const treePath = await resolveWorktreePath({ cwd, branch });
	const workspace = mkdtempSync(join(tmpdir(), 'lightsout-workspace-'));

	mkdirSync(join(cwd, planFolder), { recursive: true });
	writeFileSync(join(cwd, planFolder, 'plan.md'), planBody);
	mkdirSync(join(workspace, earlierPlanFolder), { recursive: true });
	writeFileSync(join(workspace, earlierPlanFolder, 'plan.md'), earlierPlanBody);

	if (standing !== undefined) {
		mkdirSync(treePath, { recursive: true });
		await writeWorktreeRecord({ cwd, branch, owner: standing, worktreePath: treePath, startPoint: pinnedCommit });
	}

	if (heldBy !== undefined) {
		mkdirSync(join(treePath, '.lightsout'), { recursive: true });
		writeFileSync(join(treePath, '.lightsout', 'lock.json'), JSON.stringify({ pid: process.pid, runId: heldBy, startedAt: '2026-09-11T09:00:00.000Z' }));
	}

	mockFetchDefaultBranch.mockResolvedValue('main');
	mockReadBranchWorktree.mockResolvedValue(standing === undefined ? undefined : treePath);
	mockCreateWorktree.mockResolvedValue(workspace);
	mockRequireImplementLifecycle.mockResolvedValue(undefined);
	mockRunPipelineOrFailFast.mockResolvedValue(passedResult);
	mockPrintResult.mockResolvedValue(undefined);
	mockExitAfterImplement.mockResolvedValue(undefined);

	const args = ['--plan', join(planFolder, 'plan.md')];

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, treePath, workspace, ...captured };
};

/**
 * A launching checkout that holds no plan folder at all, and a tree at the
 * TICKET BRANCH's worktree path that holds the addressed plan — what planning
 * a later plan in the ticket's own tree leaves behind.
 *
 * The run opts out of isolation, so the only checkout in play is the launching
 * one and what lands there is exactly what the recovery copied.
 */
const setupRecoveredPlan = async () => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo();
	const treePath = await resolveWorktreePath({ cwd, branch: ticketBranch });

	mkdirSync(join(treePath, laterPlanFolder), { recursive: true });
	writeFileSync(join(treePath, laterPlanFolder, 'plan.md'), planBody);
	writeFileSync(join(treePath, laterPlanFolder, 'grade-memory.json'), '{"passes":1}\n');

	mockRequireImplementLifecycle.mockResolvedValue(undefined);
	mockRunPipelineOrFailFast.mockResolvedValue(passedResult);
	mockPrintResult.mockResolvedValue(undefined);
	mockExitAfterImplement.mockResolvedValue(undefined);

	const args = ['--plan', join(laterPlanFolder, 'plan.md'), '--no-worktree'];

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, treePath, ...captured };
};

describe('implementCommand plan addresses', () => {
	test("cuts the tree on the ticket branch and copies in only the addressed plan's folder", async () => {
		const { context, workspace, logged } = await setupTicketRun();

		await implementCommand(context);

		// the branch, and every worktree call that composed it, is the ticket
		// folder — a tree named for the address would put each plan of one ticket
		// on a branch of its own
		expect(mockCreateWorktree).toHaveBeenCalledWith(expect.objectContaining({ branch: ticketBranch, owner: 'implement' }));
		expect(logged.join('\n')).toContain(`branch: ${ticketBranch}`);
		expect(readFileSync(join(workspace, laterPlanFolder, 'plan.md'), 'utf8')).toBe(planBody);
		// the sibling plan the workspace already held is neither overwritten nor
		// skipped over: the copy is judged one plan folder at a time
		expect(readFileSync(join(workspace, earlierPlanFolder, 'plan.md'), 'utf8')).toBe(earlierPlanBody);
		expect(mockRunPipelineOrFailFast).toHaveBeenCalledWith(expect.objectContaining({ cwd: workspace, planPath: join(laterPlanFolder, 'plan.md') }));
	});

	test('continues a plan address in the ticket tree an implementation run already owns', async () => {
		const { context, cwd, treePath } = await setupTicketRun({ standing: WorktreeOwner.Implement });

		await implementCommand(context);

		const record = await readWorktreeRecord({ cwd, branch: ticketBranch });
		expect(mockCreateWorktree).not.toHaveBeenCalled();
		expect(mockRunPipelineOrFailFast).toHaveBeenCalledWith(expect.objectContaining({ cwd: treePath, planPath: join(laterPlanFolder, 'plan.md') }));
		// the adoption leaves the tree recorded as an implementation run's, still
		// pointing at itself and still carrying the commit it was cut at
		expect(record).toEqual(expect.objectContaining({ owner: 'implement', worktreePath: treePath, startPoint: pinnedCommit }));
		expect(readFileSync(join(treePath, laterPlanFolder, 'plan.md'), 'utf8')).toBe(planBody);
	});

	test('refuses a plan address while a live run holds the ticket tree, naming the run', async () => {
		const { context, cwd, treePath, errors, exitCodes } = await setupTicketRun({ standing: WorktreeOwner.Plan, heldBy: 'run-ranking-in-flight' });

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		const record = await readWorktreeRecord({ cwd, branch: ticketBranch });
		expect(errors.join('\n')).toContain(treePath);
		expect(errors.join('\n')).toContain('run-ranking-in-flight');
		expect(errors.join('\n')).toContain('--no-worktree');
		// nothing was adopted, so the tree still belongs to the session that cut it
		expect(record).toEqual(expect.objectContaining({ owner: 'plan' }));
		expect(mockRunPipelineOrFailFast).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a legacy plan is still refused by the tree an implementation run owns, rather than adopting it', async () => {
		const { context, cwd, treePath, errors, exitCodes } = await setupTicketRun({
			planFolder: legacyPlanFolder,
			branch: legacyBranch,
			standing: WorktreeOwner.Implement,
		});

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		const record = await readWorktreeRecord({ cwd, branch: legacyBranch });
		expect(errors.join('\n')).toContain(treePath);
		expect(errors.join('\n')).toContain('--no-worktree');
		expect(record).toEqual(expect.objectContaining({ owner: 'implement', startPoint: pinnedCommit }));
		expect(mockRunPipelineOrFailFast).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test("recovers a plan address's folder from the ticket branch's worktree before the run starts", async () => {
		const { context, cwd, treePath, logged } = await setupRecoveredPlan();

		await implementCommand(context);

		// the tree was looked for under the ticket branch, never under the address,
		// and the whole plan folder came back — its grading memory included
		expect(logged[0]).toContain(treePath);
		expect(readFileSync(join(cwd, laterPlanFolder, 'plan.md'), 'utf8')).toBe(planBody);
		expect(readFileSync(join(cwd, laterPlanFolder, 'grade-memory.json'), 'utf8')).toBe('{"passes":1}\n');
		expect(readFileSync(join(treePath, laterPlanFolder, 'plan.md'), 'utf8')).toBe(planBody);
		expect(mockRunPipelineOrFailFast).toHaveBeenCalledWith(expect.objectContaining({ cwd, planPath: join(laterPlanFolder, 'plan.md') }));
	});
});
