import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { contradictoryWorktreeFlagsMessage } from '#src/cli/common/constants/contradictoryWorktreeFlagsMessage.ts';
import { resolvePlanWorktree } from '#src/cli/plan/common/utils/resolvePlanWorktree.ts';
import type { LightsoutConfig, WorktreeOwner, WorktreeRecord } from '#src/contracts/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

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

jest.mock('#src/worktree/index.ts', () => ({
	createWorktree: (params: CreateParams) => mockCreateWorktree(params),
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

const name = 'lo-131-plan-in-a-worktree';
const launchingHead = '3f1c0de5a1b2c3d4e5f60718293a4b5c6d7e8f90';
const otherHead = '9e8d7c6b5a49382716f5e4d3c2b1a0f9e8d7c6b5';
const pinnedStartPoint = '0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d';
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
const setupRepository = async ({ trees = {} }: { trees?: Record<string, Tree> } = {}) => {
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

/** The three isolation switches, each on its own plan so a cut can be traced back to the invocation that asked for it. */
const setupIsolationSwitches = async () => {
	const repository = await setupRepository();
	const { sourceCwd } = repository;

	return {
		...repository,
		configuredOff: { cwd: sourceCwd, config: configOf({ planWorktree: false }), flags: flagsOf(), name: 'lo-211-config-off' },
		flaggedOff: { cwd: sourceCwd, config: configOf(), flags: flagsOf(['no-worktree']), name: 'lo-212-flag-off' },
		flaggedOn: { cwd: sourceCwd, config: configOf({ planWorktree: false }), flags: flagsOf(['worktree']), name: 'lo-213-flag-on' },
	};
};

/** Every refusal this resolver answers about a tree, one plan apiece. */
const setupEveryRefusal = async () =>
	setupRepository({
		trees: {
			'lo-201-claimed-tree': { occupant: 'worktree', record: { owner: 'implement', startPoint: 'origin/main' } },
			'lo-202-unclaimed-tree': { occupant: 'worktree' },
			'lo-203-held-elsewhere': { heldElsewhere: true },
			'lo-204-occupied-by-file': { occupant: 'file', refusesCreation: true },
		},
	});

const sentenceOf = (answer: object) => ('error' in answer ? answer.error : undefined);

describe('resolvePlanWorktree', () => {
	test("cuts the plan's worktree at the launching checkout's HEAD and prints its absolute path last", async () => {
		const { sourceCwd, pathOf, config, flags } = await setupRepository();

		const worktree = await resolvePlanWorktree({ cwd: sourceCwd, config, flags, name });

		expect(worktree).toEqual({ cwd: pathOf(name), branch: name, isolated: true, created: true });
		expect(mockCreateWorktree).toHaveBeenCalledWith(expect.objectContaining({ branch: name, startPoint: launchingHead, owner: 'plan' }));
	});

	test('continues in a tree its own plan recorded, leaving the record untouched', async () => {
		const { sourceCwd, pathOf, config, flags } = await setupRepository({
			trees: { [name]: { occupant: 'worktree', record: { owner: 'plan', startPoint: pinnedStartPoint } } },
		});

		const worktree = await resolvePlanWorktree({ cwd: sourceCwd, config, flags, name });

		expect(worktree).toEqual({ cwd: pathOf(name), branch: name, isolated: true, created: false });
		expect(mockCreateWorktree).not.toHaveBeenCalled();
		expect(mockWriteWorktreeRecord).not.toHaveBeenCalled();
	});

	test("continues in the queue's ticket tree without taking its ownership", async () => {
		const { sourceCwd, pathOf, config, flags } = await setupRepository({
			trees: { [name]: { occupant: 'worktree', record: { owner: 'queue', startPoint: 'origin/main' } } },
		});

		const worktree = await resolvePlanWorktree({ cwd: sourceCwd, config, flags, name });

		expect(worktree).toEqual({ cwd: pathOf(name), branch: name, isolated: true, created: false });
		expect(mockCreateWorktree).not.toHaveBeenCalled();
		expect(mockWriteWorktreeRecord).not.toHaveBeenCalled();
	});

	test('refuses a tree an implement run owns and one nothing claims, naming the path', async () => {
		const { sourceCwd, pathOf, config, flags } = await setupEveryRefusal();

		const [implementOwned, unclaimed] = await Promise.all([
			resolvePlanWorktree({ cwd: sourceCwd, config, flags, name: 'lo-201-claimed-tree' }),
			resolvePlanWorktree({ cwd: sourceCwd, config, flags, name: 'lo-202-unclaimed-tree' }),
		]);

		expect(implementOwned).toEqual({ error: expect.stringContaining(pathOf('lo-201-claimed-tree')) });
		expect(implementOwned).toEqual({ error: expect.stringMatching(/implement/) });
		expect(unclaimed).toEqual({ error: expect.stringContaining(pathOf('lo-202-unclaimed-tree')) });
		expect(mockCreateWorktree).not.toHaveBeenCalled();
		expect(mockWriteWorktreeRecord).not.toHaveBeenCalled();
	});

	test('answers the launching checkout when planning isolation is turned off, and re-isolates on --worktree', async () => {
		const { sourceCwd, pathOf, configuredOff, flaggedOff, flaggedOn } = await setupIsolationSwitches();

		const worktrees = await Promise.all([resolvePlanWorktree(configuredOff), resolvePlanWorktree(flaggedOff), resolvePlanWorktree(flaggedOn)]);

		expect(worktrees).toEqual([
			{ cwd: sourceCwd, isolated: false, created: false },
			{ cwd: sourceCwd, isolated: false, created: false },
			{ cwd: pathOf('lo-213-flag-on'), branch: 'lo-213-flag-on', isolated: true, created: true },
		]);
		expect(mockCreateWorktree.mock.calls.map(([params]) => params.branch)).toEqual(['lo-213-flag-on']);
	});

	test('refuses --worktree and --no-worktree together before touching git', async () => {
		const { sourceCwd, config } = await setupRepository();
		const flags = flagsOf(['worktree', 'no-worktree']);

		const worktree = await resolvePlanWorktree({ cwd: sourceCwd, config, flags, name });

		expect(worktree).toStrictEqual({ error: contradictoryWorktreeFlagsMessage });
		expect(mockResolveWorktreePath).not.toHaveBeenCalled();
		expect(mockReadBranchWorktree).not.toHaveBeenCalled();
		expect(mockReadWorktreeRecord).not.toHaveBeenCalled();
		expect(mockReadGitHeadCommit).not.toHaveBeenCalled();
		expect(mockCreateWorktree).not.toHaveBeenCalled();
	});

	test('refuses a branch already checked out elsewhere and names the checkout holding it', async () => {
		const { sourceCwd, elsewhere, config, flags } = await setupRepository({ trees: { [name]: { heldElsewhere: true } } });

		const worktree = await resolvePlanWorktree({ cwd: sourceCwd, config, flags, name });

		expect(worktree).toEqual({ error: expect.stringContaining(elsewhere) });
		expect(worktree).toEqual({ error: expect.stringContaining('--no-worktree') });
		expect(mockCreateWorktree).not.toHaveBeenCalled();
	});

	test('stops with the path named when the worktree cannot be created, rather than planning in the shared checkout', async () => {
		const { sourceCwd, pathOf, config, flags } = await setupEveryRefusal();

		const worktree = await resolvePlanWorktree({ cwd: sourceCwd, config, flags, name: 'lo-204-occupied-by-file' });

		expect(worktree).toEqual({ error: expect.stringContaining(pathOf('lo-204-occupied-by-file')) });
	});

	test('stays in an unrecorded tree it is already standing in, and refuses that same tree from outside', async () => {
		const { sourceCwd, pathOf, config, flags } = await setupRepository({ trees: { [name]: { occupant: 'worktree' } } });

		const [standingIn, fromOutside] = await Promise.all([
			resolvePlanWorktree({ cwd: pathOf(name), config, flags, name }),
			resolvePlanWorktree({ cwd: sourceCwd, config, flags, name }),
		]);

		expect(standingIn).toEqual(expect.objectContaining({ cwd: pathOf(name), created: false }));
		expect(fromOutside).toEqual({ error: expect.stringContaining(pathOf(name)) });
		expect(mockCreateWorktree).not.toHaveBeenCalled();
		expect(mockWriteWorktreeRecord).not.toHaveBeenCalled();
	});

	test('every refusal names something the reader can do next', async () => {
		const { sourceCwd, elsewhere, pathOf, config, flags } = await setupEveryRefusal();

		const refusals = await Promise.all(
			['lo-201-claimed-tree', 'lo-202-unclaimed-tree', 'lo-203-held-elsewhere', 'lo-204-occupied-by-file'].map((branch) =>
				resolvePlanWorktree({ cwd: sourceCwd, config, flags, name: branch }),
			),
		);
		const sentences = refusals.map(sentenceOf);

		expect(sentences).toEqual([
			expect.stringContaining(pathOf('lo-201-claimed-tree')),
			expect.stringContaining(pathOf('lo-202-unclaimed-tree')),
			expect.stringContaining(elsewhere),
			expect.stringContaining(pathOf('lo-204-occupied-by-file')),
		]);
		expect(sentences).toEqual([
			expect.stringContaining('--no-worktree'),
			expect.stringContaining('--no-worktree'),
			expect.stringContaining(elsewhere),
			expect.stringContaining('--no-worktree'),
		]);
	});
});
