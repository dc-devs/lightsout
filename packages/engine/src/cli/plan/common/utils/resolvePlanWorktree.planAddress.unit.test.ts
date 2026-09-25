import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { resolvePlanWorktree } from '#src/cli/plan/common/utils/resolvePlanWorktree.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { RunLock } from '#src/contracts/run/RunLock.ts';
import type { WorktreeOwner } from '#src/contracts/worktree/WorktreeOwner.ts';
import type { WorktreeRecord } from '#src/contracts/worktree/WorktreeRecord.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { seedWorkOrderRecord } from '#tests/helpers/seedWorkOrderRecord.ts';

/**
 * Where a plan named by an address plans, and on which branch.
 *
 * A sibling of `resolvePlanWorktree.unit.test.ts` rather than more cases in it:
 * that file states what the resolver does with a plan named on its own, while
 * every case here starts from a plan address — a label whose work order record
 * is what says which branch the tree is cut on.
 */

// Mocked Imports
// -------------------------
// The worktree module is the seam every git command behind this resolver runs
// through, so mocking its barrel is what lets 'no git command ran', 'nothing
// was cut' and 'no record was written' be asserted at all. The directories
// themselves are real, because every path comparison goes through `realpath`.
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

interface TicketBranchParams {
	cwd: string;
	branch: string;
}

interface WriteRecordParams {
	cwd: string;
	branch: string;
	owner: WorktreeOwner;
	worktreePath: string;
	startPoint?: string;
	onProgress?: (message: string) => void;
}

const mockCreateWorktree = jest.fn<(params: CreateParams) => Promise<string | WorktreeFailure>>();
const mockReadBranchWorktree = jest.fn<(params: { cwd: string; branch: string }) => Promise<string | undefined>>();
const mockReadWorktreeRecord = jest.fn<(params: { cwd: string; branch: string }) => Promise<WorktreeRecord | undefined>>();
const mockResolveWorktreePath = jest.fn<(params: { cwd: string; branch: string }) => Promise<string>>();
const mockWriteWorktreeRecord = jest.fn<(params: WriteRecordParams) => Promise<void>>();
const mockPrepareTicketBranch = jest.fn<(params: TicketBranchParams) => Promise<{ startPoint?: string } | WorktreeFailure>>();

jest.mock('#src/worktree/index.ts', () => ({
	createWorktree: (params: CreateParams) => mockCreateWorktree(params),
	prepareWorkOrderBranch: (params: TicketBranchParams) => mockPrepareTicketBranch(params),
	readBranchWorktree: (params: { cwd: string; branch: string }) => mockReadBranchWorktree(params),
	readWorktreeRecord: (params: { cwd: string; branch: string }) => mockReadWorktreeRecord(params),
	resolveWorktreePath: (params: { cwd: string; branch: string }) => mockResolveWorktreePath(params),
	writeWorktreeRecord: (params: WriteRecordParams) => mockWriteWorktreeRecord(params),
}));
// -------------------------
const mockReadGitHeadCommit = jest.fn<(params: { cwd: string }) => Promise<string | undefined>>();

jest.mock('#src/common/git/readGitHeadCommit.ts', () => ({
	readGitHeadCommit: (params: { cwd: string }) => mockReadGitHeadCommit(params),
}));
// -------------------------
const mockReadLiveRunLock = jest.fn<(params: { cwd: string }) => Promise<RunLock | undefined>>();

jest.mock('#src/runState/index.ts', () => ({
	readLiveRunLock: (params: { cwd: string }) => mockReadLiveRunLock(params),
}));
// -------------------------

const name = 'lo-131-plan-in-a-worktree';
const launchingHead = '3f1c0de5a1b2c3d4e5f60718293a4b5c6d7e8f90';
const otherHead = '9e8d7c6b5a49382716f5e4d3c2b1a0f9e8d7c6b5';
const pinnedStartPoint = '0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d';
const workOrderName = 'lo-7-search';
const planAddress = 'lo-7-search/002-ranking';
const prefixedBranch = 'feature/lo-7-search';
const pushedTicketCommit = 'c0ffee11223344556677889900aabbccddeeff01';
const liveRun = { pid: 4242, runId: 'run-20260911-090000-ranking', startedAt: '2026-09-11T09:00:00.000Z' };
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };

/** One branch's state in the arranged repository. */
interface Tree {
	/** What sits at `<worktrees root>/<branch>` on disk. */
	occupant?: 'worktree' | 'file';
	/** True when git lists the branch as checked out in a directory other than its tree path. */
	heldElsewhere?: true;
	/** The ownership record beside the branch, when one was written. */
	record?: { owner: WorktreeOwner; startPoint?: string };
	/** True when `createWorktree` refuses to cut this branch, as it does over a directory already at the path. */
	refusesCreation?: true;
}

const flagsOf = (names: string[] = []) => new Map<string, string | true>(names.map((flag) => [flag, true]));

const configOf = ({ planWorktree }: { planWorktree?: boolean } = {}): LightsoutConfig => ({
	gates,
	...(planWorktree === undefined ? {} : { plan: { worktree: planWorktree } }),
});

/**
 * A launching checkout beside its worktrees root, with each named branch's
 * tree, holder and record answered by the mocked worktree module. Paths are
 * filesystem-resolved up front, because git answers resolved paths.
 */
const setupRepository = async ({ trees = {}, names = [] }: { trees?: Record<string, Tree>; names?: string[] } = {}) => {
	const root = await realpath(await freshCwd());
	const sourceCwd = join(root, 'launching-checkout');
	const elsewhere = join(root, 'somebody-elses-checkout');
	const worktreesRoot = join(root, 'launching-checkout-worktrees');
	const pathOf = (branch: string) => join(worktreesRoot, branch);

	const occupy = async ([branch, { occupant }]: [string, Tree]) => {
		if (occupant === 'worktree') {
			await mkdir(pathOf(branch), { recursive: true });
		}

		if (occupant === 'file') {
			await writeFile(pathOf(branch), 'not a worktree\n');
		}
	};
	const holderOf = (branch: string) => {
		if (trees[branch]?.heldElsewhere) {
			return elsewhere;
		}

		return trees[branch]?.occupant === 'worktree' ? pathOf(branch) : undefined;
	};

	await Promise.all([sourceCwd, elsewhere, worktreesRoot].map((dir) => mkdir(dir, { recursive: true })));
	await Promise.all(Object.entries(trees).map(occupy));

	// The resolver reads the branch off the plan's work order record, so every
	// label a case names needs one. Each stores the branch its own label spells,
	// which is what the default template renders; the prefixed case below writes
	// its own record instead.
	for (const label of [...new Set([...Object.keys(trees), ...names, name, workOrderName])]) {
		seedWorkOrderRecord({ cwd: sourceCwd, name: label });
	}

	mockResolveWorktreePath.mockImplementation(async ({ branch }) => pathOf(branch));
	mockReadBranchWorktree.mockImplementation(async ({ branch }) => holderOf(branch));
	mockReadWorktreeRecord.mockImplementation(async ({ branch }) => {
		const record = trees[branch]?.record;

		return record === undefined ? undefined : { branch, worktreePath: pathOf(branch), createdAt: '2026-09-01T09:00:00.000Z', ...record };
	});
	// The refusal is `createWorktree`'s own sentence for a directory already at the path.
	mockCreateWorktree.mockImplementation(async ({ branch }) =>
		trees[branch]?.refusesCreation ? { error: `something is already at ${pathOf(branch)}, so no worktree was made for '${branch}'` } : pathOf(branch),
	);
	mockWriteWorktreeRecord.mockResolvedValue(undefined);
	mockReadGitHeadCommit.mockImplementation(async ({ cwd }) => (cwd === sourceCwd ? launchingHead : otherHead));

	return { sourceCwd, elsewhere, pathOf, config: configOf(), flags: flagsOf() };
};

/**
 * A ticket folder's tree, named by a plan address. Every branch in `trees` is a
 * ticket branch, because that is the only thing this resolver hands the worktree
 * module for an address. `prepareWorkOrderBranch` answers 'use the local branch as
 * it stands' unless a test says otherwise, and the run lock is held only in the
 * trees `liveTrees` names.
 */
const setupTicketPlan = async ({ trees = {}, liveTrees = [] }: { trees?: Record<string, Tree>; liveTrees?: string[] } = {}) => {
	const repository = await setupRepository({ trees, names: ['lo-8-ranking', 'lo-9-facets'] });

	mockPrepareTicketBranch.mockResolvedValue({});
	mockReadLiveRunLock.mockImplementation(async ({ cwd }) => (liveTrees.some((branch) => cwd === repository.pathOf(branch)) ? liveRun : undefined));

	return repository;
};

/**
 * A work order whose record stores a branch its label does not spell, written
 * into the checkout's own work-orders folder so the resolver reads a real
 * record rather than a stub of one.
 */
const setupPrefixedWorkOrder = async () => {
	const repository = await setupTicketPlan();

	seedWorkOrderRecord({ cwd: repository.sourceCwd, name: workOrderName, branch: prefixedBranch });

	return repository;
};

const sentenceOf = (answer: object) => ('error' in answer ? answer.error : undefined);
describe('resolvePlanWorktree', () => {
	test('keys the tree, its branch and its ownership record by the ticket-branch segment of a plan address', async () => {
		const { sourceCwd, pathOf, config, flags } = await setupTicketPlan();

		const worktree = await resolvePlanWorktree({ cwd: sourceCwd, config, flags, name: planAddress });
		const branchesAsked = [
			...mockResolveWorktreePath.mock.calls,
			...mockReadBranchWorktree.mock.calls,
			...mockReadWorktreeRecord.mock.calls,
			...mockCreateWorktree.mock.calls,
		].map(([params]) => params.branch);

		expect(worktree).toStrictEqual({ cwd: pathOf(workOrderName), branch: workOrderName, isolated: true, created: true });
		expect(branchesAsked).toEqual(['lo-7-search', 'lo-7-search', 'lo-7-search', 'lo-7-search']);
	});

	test('continues a plan address in the ticket tree an implementation run owns, leaving the record untouched', async () => {
		const { sourceCwd, pathOf, config, flags } = await setupTicketPlan({
			trees: { [workOrderName]: { occupant: 'worktree', record: { owner: 'implement', startPoint: pinnedStartPoint } } },
		});

		const worktree = await resolvePlanWorktree({ cwd: sourceCwd, config, flags, name: planAddress });

		expect(worktree).toStrictEqual({ cwd: pathOf(workOrderName), branch: workOrderName, isolated: true, created: false });
		expect(mockCreateWorktree).not.toHaveBeenCalled();
		expect(mockWriteWorktreeRecord).not.toHaveBeenCalled();
	});

	test('refuses a plan address in the ticket tree while a live run holds its run lock, naming the run', async () => {
		const { sourceCwd, pathOf, config, flags } = await setupTicketPlan({
			trees: {
				'lo-7-search': { occupant: 'worktree', record: { owner: 'plan' } },
				'lo-8-ranking': { occupant: 'worktree', record: { owner: 'queue' } },
				'lo-9-facets': { occupant: 'worktree', record: { owner: 'implement' } },
			},
			liveTrees: ['lo-7-search', 'lo-8-ranking', 'lo-9-facets'],
		});

		const refusals = await Promise.all(
			['lo-7-search/001-basics', 'lo-8-ranking/002-ranking', 'lo-9-facets/003-facets'].map((address) =>
				resolvePlanWorktree({ cwd: sourceCwd, config, flags, name: address }),
			),
		);

		const sentences = refusals.map(sentenceOf);

		expect(sentences).toEqual([
			expect.stringContaining(pathOf('lo-7-search')),
			expect.stringContaining(pathOf('lo-8-ranking')),
			expect.stringContaining(pathOf('lo-9-facets')),
		]);
		expect(sentences).toEqual(Array(3).fill(expect.stringContaining('run-20260911-090000-ranking')));
		expect(sentences).toEqual(Array(3).fill(expect.stringContaining('--no-worktree')));
	});

	test("cuts a later plan's tree at the pushed ticket branch when only the remote holds it", async () => {
		const { sourceCwd, pathOf, config, flags } = await setupTicketPlan();
		mockPrepareTicketBranch.mockResolvedValue({ startPoint: pushedTicketCommit });

		const worktree = await resolvePlanWorktree({ cwd: sourceCwd, config, flags, name: planAddress });

		expect(worktree).toStrictEqual({ cwd: pathOf(workOrderName), branch: workOrderName, isolated: true, created: true });
		expect(mockPrepareTicketBranch).toHaveBeenCalledWith(expect.objectContaining({ branch: workOrderName }));
		expect(mockCreateWorktree).toHaveBeenCalledWith(expect.objectContaining({ branch: workOrderName, startPoint: pushedTicketCommit }));
	});

	test("plans on the branch the work order's record stores", async () => {
		const { sourceCwd, pathOf, config, flags } = await setupPrefixedWorkOrder();

		const worktree = await resolvePlanWorktree({ cwd: sourceCwd, config, flags, name: planAddress });
		const branchesAsked = [...mockResolveWorktreePath.mock.calls, ...mockReadBranchWorktree.mock.calls, ...mockCreateWorktree.mock.calls].map(
			([params]) => params.branch,
		);

		expect(worktree).toStrictEqual({ cwd: pathOf(prefixedBranch), branch: prefixedBranch, isolated: true, created: true });
		expect(branchesAsked).toEqual([prefixedBranch, prefixedBranch, prefixedBranch]);
	});
});
