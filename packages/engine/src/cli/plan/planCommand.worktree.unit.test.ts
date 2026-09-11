import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { planCommand } from '#src/cli/plan/planCommand.ts';
import type { LightsoutConfig, WorktreeOwner, WorktreeRecord } from '#src/contracts/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

// Mocked Imports
// -------------------------
// The sibling planCommand.unit.test.ts stubs the planning-worktree opener to pin
// routing. This suite runs the real opener, resolver and stocking copy under
// `plan workspace`, so the announcement, the copied plan folder and the printed
// path are asserted as the command produces them. Only the git seams are
// mocked: the worktree module's barrel and the HEAD read. The directories are
// real, because every path comparison goes through `realpath` and the plan
// folder is copied on disk.
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
const mockReadBranchWorktree = jest.fn<(params: { cwd: string; branch: string }) => Promise<string | undefined>>();
const mockReadWorktreeRecord = jest.fn<(params: { cwd: string; branch: string }) => Promise<WorktreeRecord | undefined>>();
const mockResolveWorktreePath = jest.fn<(params: { cwd: string; branch: string }) => Promise<string>>();

jest.mock('#src/worktree/index.ts', () => ({
	createWorktree: (params: CreateParams) => mockCreateWorktree(params),
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

const name = 'lo-131-plan-in-a-worktree';
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
 * checkout with no commit, whose HEAD reads as nothing. `unstockable` makes the
 * cut tree's `.lightsout` a plain file, so no plan folder can be copied in.
 * `brainstorm` plants a plan folder in the launching checkout.
 */
const setupWorkspace = async ({
	flags = [],
	launchFromTree = false,
	record,
	committed = true,
	unstockable = false,
	brainstorm = false,
}: {
	flags?: string[];
	launchFromTree?: boolean;
	record?: { owner: WorktreeOwner; startPoint?: string };
	committed?: boolean;
	unstockable?: boolean;
	brainstorm?: boolean;
} = {}) => {
	const captured = captureCommandOutput();
	const root = await realpath(await freshCwd());
	const sourceCwd = join(root, 'launching-checkout');
	const tree = join(root, 'launching-checkout-worktrees', name);
	const sourcePlanDir = join(sourceCwd, '.lightsout', 'plans', name);

	await mkdir(sourceCwd, { recursive: true });
	await writeFile(join(sourceCwd, 'lightsout.config.json'), JSON.stringify({ gates, worktree: { setup: setupCommand } }));

	if (launchFromTree) {
		await mkdir(tree, { recursive: true });
	}

	if (brainstorm) {
		await mkdir(sourcePlanDir, { recursive: true });
		await writeFile(join(sourcePlanDir, 'brainstorm-notes.md'), '# Brainstorm notes\n');
		await writeFile(join(sourcePlanDir, 'brainstorm-decisions.json'), '{"decisions":[]}\n');
	}

	mockResolveWorktreePath.mockResolvedValue(tree);
	mockReadBranchWorktree.mockResolvedValue(launchFromTree ? tree : undefined);
	mockReadWorktreeRecord.mockResolvedValue(
		record === undefined ? undefined : { branch: name, worktreePath: tree, createdAt: '2026-09-01T09:00:00.000Z', ...record },
	);
	mockReadGitHeadCommit.mockResolvedValue(committed ? launchingHead : undefined);
	// The cut itself: git would make the directory, so the mock does.
	mockCreateWorktree.mockImplementation(async () => {
		await mkdir(tree, { recursive: true });

		if (unstockable) {
			await writeFile(join(tree, '.lightsout'), 'not a directory\n');
		}

		return tree;
	});

	const args = ['workspace', '--name', name, ...flags];
	const cwd = launchFromTree ? tree : sourceCwd;

	return { context: { flags: parseFlags({ args }), rest: args, cwd }, sourceCwd, tree, sourcePlanDir, ...captured };
};

/** The files a plan folder holds, read back by name. */
const readPlanFolder = async ({ dir }: { dir: string }) => ({
	notes: await readFile(join(dir, 'brainstorm-notes.md'), 'utf8'),
	decisions: await readFile(join(dir, 'brainstorm-decisions.json'), 'utf8'),
});

describe('planCommand', () => {
	test('cuts the plan worktree at the launching HEAD, stocks it with the brainstorm folder, and prints its path last', async () => {
		const { context, tree, sourcePlanDir, logged, errors, exitCodes } = await setupWorkspace({ brainstorm: true });

		await expect(planCommand(context)).rejects.toThrow(/process\.exit/);

		const stocked = await readPlanFolder({ dir: join(tree, '.lightsout', 'plans', name) });
		const original = await readPlanFolder({ dir: sourcePlanDir });
		// the launching checkout's own config decides the setup a new planning tree runs
		expect(mockCreateWorktree).toHaveBeenCalledWith(expect.objectContaining({ startPoint: launchingHead, owner: 'plan', setup: setupCommand }));
		// one announcement naming the tree and its branch, then the path alone
		expect(logged).toEqual([expect.stringContaining(tree), tree]);
		expect(logged[0]).toContain(`branch: ${name}`);
		expect(stocked).toStrictEqual({ notes: '# Brainstorm notes\n', decisions: '{"decisions":[]}\n' });
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

		expect(mockCreateWorktree).toHaveBeenCalledWith(expect.objectContaining({ branch: name, startPoint: pinnedStartPoint }));
		expect(logged.at(-1)).toBe(tree);
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

	test('stops with the destination named when the brainstorm folder cannot be copied into the tree, printing no path', async () => {
		const { context, tree, sourcePlanDir, logged, errors, exitCodes } = await setupWorkspace({ brainstorm: true, unstockable: true });

		await expect(planCommand(context)).rejects.toThrow(/process\.exit/);

		const original = await readPlanFolder({ dir: sourcePlanDir });
		expect(errors).toEqual([expect.stringContaining(join(tree, '.lightsout', 'plans', name))]);
		expect(logged).not.toContain(tree);
		expect(original).toStrictEqual({ notes: '# Brainstorm notes\n', decisions: '{"decisions":[]}\n' });
		expect(exitCodes).toStrictEqual([1]);
	});
});
