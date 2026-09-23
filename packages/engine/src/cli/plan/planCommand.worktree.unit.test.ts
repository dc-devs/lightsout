import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { planCommand } from '#src/cli/plan/planCommand.ts';
import type { LightsoutConfig, WorktreeOwner, WorktreeRecord } from '#src/contracts/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';
import { seedWorkOrderRecord } from '#tests/helpers/seedWorkOrderRecord.ts';

// Mocked Imports
// -------------------------
// The sibling planCommand.unit.test.ts stubs the planning-worktree opener to pin
// routing. This suite runs the real opener and resolver under `plan workspace`,
// so the announcement, the untouched plan folder and the printed path are
// asserted as the command produces them. Only the git seams are mocked: the
// worktree module's barrel and the HEAD read. The directories are real, because
// every path comparison goes through `realpath`.
type WorktreeFailure = { error: string };

interface CreateParams {
	cwd: string;
	branch: string;
	startPoint: string;
	setup?: string;
	owner: WorktreeOwner;
	reuseExisting: boolean;
	onProgress?: (message: string) => void;
}

const mockCreateWorktree = jest.fn<(params: CreateParams) => Promise<string | WorktreeFailure>>();
const mockPrepareTicketBranch = jest.fn<(params: { cwd: string; branch: string }) => Promise<{ startPoint?: string } | WorktreeFailure>>();
const mockReadBranchWorktree = jest.fn<(params: { cwd: string; branch: string }) => Promise<string | undefined>>();
const mockReadWorktreeRecord = jest.fn<(params: { cwd: string; branch: string }) => Promise<WorktreeRecord | undefined>>();
const mockResolveWorktreePath = jest.fn<(params: { cwd: string; branch: string }) => Promise<string>>();

jest.mock('#src/worktree/index.ts', () => ({
	createWorktree: (params: CreateParams) => mockCreateWorktree(params),
	prepareWorkOrderBranch: (params: { cwd: string; branch: string }) => mockPrepareTicketBranch(params),
	readBranchWorktree: (params: { cwd: string; branch: string }) => mockReadBranchWorktree(params),
	readWorktreeRecord: (params: { cwd: string; branch: string }) => mockReadWorktreeRecord(params),
	resolveWorktreePath: (params: { cwd: string; branch: string }) => mockResolveWorktreePath(params),
}));
// -------------------------
const mockReadGitHeadCommit = jest.fn<(params: { cwd: string }) => Promise<string | undefined>>();

jest.mock('#src/common/git/readGitHeadCommit.ts', () => ({
	readGitHeadCommit: (params: { cwd: string }) => mockReadGitHeadCommit(params),
}));
// -------------------------

const workOrderName = 'lo-131-plan-in-a-worktree';
const name = `${workOrderName}/001-plan-in-a-worktree`;
const launchingHead = '3f1c0de5a1b2c3d4e5f60718293a4b5c6d7e8f90';
const pinnedStartPoint = '0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d';
const setupCommand = 'pnpm install --frozen-lockfile';
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };

/**
 * A launching checkout beside its worktrees root, running `plan workspace`.
 *
 * `launchFromTree` puts a tree at the plan's path before the command runs and
 * launches the command from inside it. `record` is the ownership record beside
 * the branch. `committed: false` is a launching
 * checkout with no commit, whose HEAD reads as nothing. `brainstorm` plants a
 * plan folder in the launching checkout.
 */
const setupWorkspace = async ({
	flags = [],
	launchFromTree = false,
	record,
	committed = true,
	brainstorm = false,
	workOrder = {},
}: {
	flags?: string[];
	launchFromTree?: boolean;
	record?: { owner: WorktreeOwner; startPoint?: string };
	committed?: boolean;
	brainstorm?: boolean;
	/**
	 * The work order record beside this plan's label. `branch` is what it
	 * stores — equal to the label by default, and a different string under a
	 * prefixed template. `'unclaimed'` writes no record at all, which is a
	 * `--name` nothing ever authored.
	 */
	workOrder?: { branch?: string } | 'unclaimed';
} = {}) => {
	const captured = captureCommandOutput();
	const root = await realpath(await freshCwd());
	const sourceCwd = join(root, 'launching-checkout');
	const tree = join(root, 'launching-checkout-worktrees', workOrderName);
	const sourcePlanDir = planWorkspaceFolder({ cwd: sourceCwd, name });

	await mkdir(sourceCwd, { recursive: true });
	// The branch a planning session is cut on is the work order record's answer.
	if (workOrder !== 'unclaimed') {
		seedWorkOrderRecord({ cwd: sourceCwd, name: workOrderName, branch: workOrder.branch });
	}

	await writeFile(join(sourceCwd, 'lightsout.config.json'), JSON.stringify({ gates, worktree: { setup: setupCommand } }));

	if (launchFromTree) {
		await mkdir(tree, { recursive: true });
		// Launched from inside the tree, which is no git worktree here, so its own
		// directory is where the record is looked for.
		if (workOrder !== 'unclaimed') {
			seedWorkOrderRecord({ cwd: tree, name: workOrderName, branch: workOrder.branch });
		}
	}

	if (brainstorm) {
		await mkdir(sourcePlanDir, { recursive: true });
		await writeFile(join(sourcePlanDir, 'brainstorm-notes.md'), '# Brainstorm notes\n');
		await writeFile(join(sourcePlanDir, 'brainstorm-decisions.json'), '{"decisions":[]}\n');
	}

	mockResolveWorktreePath.mockResolvedValue(tree);
	mockReadBranchWorktree.mockResolvedValue(launchFromTree ? tree : undefined);
	mockReadWorktreeRecord.mockResolvedValue(
		record === undefined ? undefined : { branch: workOrderName, worktreePath: tree, createdAt: '2026-09-01T09:00:00.000Z', ...record },
	);
	mockPrepareTicketBranch.mockResolvedValue({});
	mockReadGitHeadCommit.mockResolvedValue(committed ? launchingHead : undefined);
	// The cut itself: git would make the directory, so the mock does.
	mockCreateWorktree.mockImplementation(async () => {
		await mkdir(tree, { recursive: true });

		return tree;
	});

	const args = ['workspace', '--name', name, ...flags];
	const cwd = launchFromTree ? tree : sourceCwd;

	return { context: { flags: parseFlags({ args }), rest: args, cwd }, sourceCwd, tree, sourcePlanDir, ...captured };
};

/**
 * The same launching checkout, running `plan workspace` for a plan addressed
 * inside its ticket folder — `lo-7-search/002-ranking`, whose plan folder is the
 * only thing the checkout holds.
 *
 * Nothing holds the ticket branch and no ownership record names it, so the
 * command cuts a fresh tree, and the ticket branch needs no move, so the branch
 * preparation answers no start point of its own.
 */
const setupTicketPlanWorkspace = async () => {
	const captured = captureCommandOutput();
	const root = await realpath(await freshCwd());
	const sourceCwd = join(root, 'launching-checkout');
	const tree = join(root, 'launching-checkout-worktrees', 'lo-7-search');
	const sourcePlanDir = join(sourceCwd, '.lightsout', 'work-orders', 'lo-7-search', 'plans', '002-ranking');

	await mkdir(sourcePlanDir, { recursive: true });
	seedWorkOrderRecord({ cwd: sourceCwd, name: 'lo-7-search' });
	await writeFile(join(sourceCwd, 'lightsout.config.json'), JSON.stringify({ gates, worktree: { setup: setupCommand } }));
	await writeFile(join(sourcePlanDir, 'brainstorm-notes.md'), '# Brainstorm notes\n');
	await writeFile(join(sourcePlanDir, 'brainstorm-decisions.json'), '{"decisions":[]}\n');

	mockResolveWorktreePath.mockResolvedValue(tree);
	mockReadBranchWorktree.mockResolvedValue(undefined);
	mockReadWorktreeRecord.mockResolvedValue(undefined);
	mockPrepareTicketBranch.mockResolvedValue({});
	mockReadGitHeadCommit.mockResolvedValue(launchingHead);
	// The cut itself: git would make the directory, so the mock does.
	mockCreateWorktree.mockImplementation(async () => {
		await mkdir(tree, { recursive: true });

		return tree;
	});

	const args = ['workspace', '--name', 'lo-7-search/002-ranking'];

	return { context: { flags: parseFlags({ args }), rest: args, cwd: sourceCwd }, sourceCwd, tree, ...captured };
};

/**
 * The same launching checkout and plan address, with a tree already standing at
 * the TICKET branch's path — the tree an earlier plan of this ticket was
 * planned and built in.
 *
 * `owner` is what that tree's ownership record names. `heldBy` plants a live
 * run lock inside it, this process's own pid being the one lock a test can
 * prove alive, which is what says a run is still editing the tree rather than
 * having finished with it.
 */
const setupStandingTicketTree = async ({ owner, heldBy }: { owner: WorktreeOwner; heldBy?: string }) => {
	const captured = captureCommandOutput();
	const root = await realpath(await freshCwd());
	const sourceCwd = join(root, 'launching-checkout');
	const tree = join(root, 'launching-checkout-worktrees', 'lo-7-search');
	const sourcePlanDir = join(sourceCwd, '.lightsout', 'work-orders', 'lo-7-search', 'plans', '002-ranking');

	await mkdir(sourcePlanDir, { recursive: true });
	await mkdir(tree, { recursive: true });
	seedWorkOrderRecord({ cwd: sourceCwd, name: 'lo-7-search' });
	await writeFile(join(sourceCwd, 'lightsout.config.json'), JSON.stringify({ gates }));
	await writeFile(join(sourcePlanDir, 'brainstorm-notes.md'), '# Brainstorm notes\n');
	await writeFile(join(sourcePlanDir, 'brainstorm-decisions.json'), '{"decisions":[]}\n');

	if (heldBy !== undefined) {
		await mkdir(join(tree, '.lightsout'), { recursive: true });
		await writeFile(join(tree, '.lightsout', 'lock.json'), JSON.stringify({ pid: process.pid, runId: heldBy, startedAt: '2026-09-11T09:00:00.000Z' }));
	}

	mockResolveWorktreePath.mockResolvedValue(tree);
	mockReadBranchWorktree.mockResolvedValue(tree);
	mockReadWorktreeRecord.mockResolvedValue({ branch: 'lo-7-search', owner, worktreePath: tree, createdAt: '2026-09-01T09:00:00.000Z' });
	mockPrepareTicketBranch.mockResolvedValue({});
	mockReadGitHeadCommit.mockResolvedValue(launchingHead);

	const args = ['workspace', '--name', 'lo-7-search/002-ranking'];

	return { context: { flags: parseFlags({ args }), rest: args, cwd: sourceCwd }, sourceCwd, tree, ...captured };
};

/** The files a plan folder holds, read back by name. */
const readPlanFolder = async ({ dir }: { dir: string }) => ({
	notes: await readFile(join(dir, 'brainstorm-notes.md'), 'utf8'),
	decisions: await readFile(join(dir, 'brainstorm-decisions.json'), 'utf8'),
});

describe('planCommand', () => {
	test('cuts the plan worktree at the launching HEAD, leaves the plan folder in the launching checkout, and prints its path last', async () => {
		const { context, tree, sourcePlanDir, logged, errors, exitCodes } = await setupWorkspace({ brainstorm: true });

		await expect(planCommand(context)).rejects.toThrow(/process\.exit/);

		const original = await readPlanFolder({ dir: sourcePlanDir });
		// the launching checkout's own config decides the setup a new planning tree runs
		expect(mockCreateWorktree).toHaveBeenCalledWith(expect.objectContaining({ startPoint: launchingHead, owner: 'plan', setup: setupCommand }));
		// one announcement naming the tree and its branch, then the path alone
		expect(logged).toEqual([expect.stringContaining(tree), tree]);
		expect(logged[0]).toContain(`branch: ${workOrderName}`);
		// the tree holds code work only, so nothing was copied into it and the
		// launching checkout's folder is exactly as it was
		expect(existsSync(join(tree, '.lightsout', 'work-orders'))).toBe(false);
		expect(original).toStrictEqual({ notes: '# Brainstorm notes\n', decisions: '{"decisions":[]}\n' });
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('launched from inside the tree, answers it with no announcement, because the session moved nowhere', async () => {
		const { context, tree, logged, exitCodes } = await setupWorkspace({ launchFromTree: true });

		await expect(planCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual([tree]);
		expect(mockCreateWorktree).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([0]);
	});

	test('with --no-worktree, prints the launching checkout and asks git nothing', async () => {
		const { context, sourceCwd, logged, exitCodes } = await setupWorkspace({ flags: ['--no-worktree'], brainstorm: true });

		await expect(planCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual([sourceCwd]);
		expect(mockResolveWorktreePath).not.toHaveBeenCalled();
		expect(mockCreateWorktree).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([0]);
	});

	test('re-cuts a deleted planning tree at the commit its record pinned, not at the launching HEAD', async () => {
		const { context, tree, logged, exitCodes } = await setupWorkspace({ record: { owner: 'plan', startPoint: pinnedStartPoint } });

		await expect(planCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockCreateWorktree).toHaveBeenCalledWith(expect.objectContaining({ branch: workOrderName, startPoint: pinnedStartPoint }));
		expect(logged.at(-1)).toBe(tree);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('refuses a --name no work order claims, naming the work order rather than planning on a branch nothing authored', async () => {
		const { context, logged, errors, exitCodes } = await setupWorkspace({ workOrder: 'unclaimed' });

		await expect(planCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors).toEqual([expect.stringContaining(workOrderName)]);
		expect(errors).toEqual([expect.stringContaining('--no-worktree')]);
		expect(logged).toStrictEqual([]);
		expect(mockCreateWorktree).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test('cuts the tree on the branch the record stores, not on the plan address’s first segment', async () => {
		const { context, logged, exitCodes } = await setupWorkspace({ workOrder: { branch: 'feature/lo-131-plan-in-a-worktree' } });

		await expect(planCommand(context)).rejects.toThrow(/process\.exit/);

		// The label names the work order to look up; the branch is whatever its
		// record stores, and under a prefixed template those are two strings.
		expect(mockCreateWorktree).toHaveBeenCalledWith(expect.objectContaining({ branch: 'feature/lo-131-plan-in-a-worktree' }));
		expect(logged[0]).toContain('branch: feature/lo-131-plan-in-a-worktree');
		expect(exitCodes).toStrictEqual([0]);
	});

	test('refuses a launching checkout with no commit to plan from, naming the path and printing none', async () => {
		const { context, tree, logged, errors, exitCodes } = await setupWorkspace({ committed: false });

		await expect(planCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors).toEqual([expect.stringContaining(tree)]);
		expect(errors).toEqual([expect.stringContaining('--no-worktree')]);
		expect(logged).toStrictEqual([]);
		expect(mockCreateWorktree).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test("a plan address cuts its tree on the ticket branch and leaves that plan's folder where it is", async () => {
		const { context, sourceCwd, tree, logged, errors, exitCodes } = await setupTicketPlanWorkspace();

		await expect(planCommand(context)).rejects.toThrow(/process\.exit/);

		// the tree and the branch it stands on are the ticket folder's, never the plan address
		expect(mockResolveWorktreePath).toHaveBeenCalledWith({ cwd: sourceCwd, branch: 'lo-7-search' });
		expect(mockCreateWorktree).toHaveBeenCalledWith(expect.objectContaining({ branch: 'lo-7-search', owner: 'plan' }));
		// one announcement naming the tree and its branch, then the path alone
		expect(logged).toEqual([expect.stringContaining(tree), tree]);
		expect(logged[0]).toMatch(/branch: lo-7-search$/);
		expect(existsSync(join(tree, '.lightsout', 'work-orders'))).toBe(false);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a later plan continues in the ticket tree an implementation run owns, carrying no plan folder into it', async () => {
		const { context, tree, logged, errors, exitCodes } = await setupStandingTicketTree({ owner: 'implement' });

		await expect(planCommand(context)).rejects.toThrow(/process\.exit/);

		// the tree an earlier plan's run adopted is where the next plan belongs, so
		// nothing is cut and the path is answered as it stands
		expect(mockCreateWorktree).not.toHaveBeenCalled();
		expect(logged.at(-1)).toBe(tree);
		expect(existsSync(join(tree, '.lightsout', 'work-orders'))).toBe(false);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('refuses a later plan while a live run holds the ticket tree, naming the run and printing no path', async () => {
		const { context, tree, logged, errors, exitCodes } = await setupStandingTicketTree({ owner: 'plan', heldBy: 'run-ranking-in-flight' });

		await expect(planCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors).toEqual([expect.stringContaining(tree)]);
		expect(errors).toEqual([expect.stringContaining('run-ranking-in-flight')]);
		expect(errors).toEqual([expect.stringContaining('--no-worktree')]);
		expect(logged).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([1]);
	});
});
