import { join, resolve } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { contradictoryWorktreeFlagsMessage } from '#src/cli/common/constants/contradictoryWorktreeFlagsMessage.ts';
import { resolveRunWorkspace } from '#src/cli/common/implementRun/resolveRunWorkspace.ts';
import type { LightsoutConfig, WorktreeOwner } from '#src/contracts/index.ts';

// Mocked Imports
// -------------------------
// The worktree module is the seam every git command behind this resolver runs
// through, so mocking its barrel is what lets 'no git command ran' and 'nothing
// was created' be asserted at all. `resolveRunBranch` is deliberately NOT
// mocked: it is pure, and one row below turns on an input the real one refuses.
type WorktreeFailure = { error: string };

interface CreateParams {
	cwd: string;
	branch: string;
	defaultBranch: string;
	setup?: string;
	owner: WorktreeOwner;
	reuseExisting: boolean;
	onProgress?: (message: string) => void;
}

const mockCreateWorktree = jest.fn<(params: CreateParams) => Promise<string | WorktreeFailure>>();
const mockFetchDefaultBranch = jest.fn<(params: { cwd: string }) => Promise<string | WorktreeFailure>>();
const mockReadBranchWorktree = jest.fn<(params: { cwd: string; branch: string }) => Promise<string | undefined>>();

jest.mock('#src/worktree/index.ts', () => ({
	createWorktree: (params: CreateParams) => mockCreateWorktree(params),
	fetchDefaultBranch: (params: { cwd: string }) => mockFetchDefaultBranch(params),
	readBranchWorktree: (params: { cwd: string; branch: string }) => mockReadBranchWorktree(params),
}));
// -------------------------
const mockLinkRunRecords = jest.fn<(params: { sourceCwd: string; workspace: string }) => Promise<{ error: string } | undefined>>();

jest.mock('#src/cli/common/implementRun/linkRunRecords.ts', () => ({
	linkRunRecords: (params: { sourceCwd: string; workspace: string }) => mockLinkRunRecords(params),
}));
// -------------------------

const sourceCwd = resolve('/tmp/lightsout-launching-checkout');
const branch = 'lo-9-isolated-run';
const planPath = join('.lightsout', 'plans', branch);
const worktreePath = resolve('/tmp/lightsout-launching-checkout-worktrees', branch);
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };

/** What the mocked worktree module and record linker answer this resolver back. */
interface Answers {
	/** The checkout already holding the branch, when a case is about one. */
	holder?: string;
	fetched?: string | WorktreeFailure;
	created?: string | WorktreeFailure;
	linked?: { error: string };
}

/** A repo whose branch is free, whose remote answers, and whose tree is cut without complaint. */
const setupWorkspace = ({ worktree, setup, flags = [], answers = {} }: { worktree?: boolean; setup?: string; flags?: string[]; answers?: Answers } = {}) => {
	const { holder, fetched = 'main', created = worktreePath, linked } = answers;

	mockFetchDefaultBranch.mockResolvedValue(fetched);
	mockReadBranchWorktree.mockResolvedValue(holder);
	mockCreateWorktree.mockResolvedValue(created);
	mockLinkRunRecords.mockResolvedValue(linked);

	const config: LightsoutConfig = {
		gates,
		...(worktree === undefined ? {} : { implement: { worktree } }),
		...(setup === undefined ? {} : { worktree: { setup } }),
	};

	return { config, flags: new Map<string, string | true>(flags.map((name) => [name, true])) };
};

describe('resolveRunWorkspace', () => {
	test('refuses both worktree flags together before running any git command', async () => {
		const { config, flags } = setupWorkspace({ flags: ['worktree', 'no-worktree'] });

		const workspace = await resolveRunWorkspace({ cwd: sourceCwd, config, flags, planPath });

		expect(workspace).toStrictEqual({ error: contradictoryWorktreeFlagsMessage });
		expect(mockReadBranchWorktree).not.toHaveBeenCalled();
		expect(mockFetchDefaultBranch).not.toHaveBeenCalled();
		expect(mockCreateWorktree).not.toHaveBeenCalled();
	});

	test('builds in the launching checkout when implement.worktree is false', async () => {
		const { config, flags } = setupWorkspace({ worktree: false });

		const workspace = await resolveRunWorkspace({ cwd: sourceCwd, config, flags, planPath });

		expect(workspace).toEqual(expect.objectContaining({ cwd: sourceCwd, isolated: false, created: false }));
		expect(mockFetchDefaultBranch).not.toHaveBeenCalled();
		expect(mockCreateWorktree).not.toHaveBeenCalled();
	});

	test('the worktree flag overrides a configuration that turned isolation off', async () => {
		const { config, flags } = setupWorkspace({ worktree: false, flags: ['worktree'] });

		const workspace = await resolveRunWorkspace({ cwd: sourceCwd, config, flags, planPath });

		expect(workspace).toEqual(expect.objectContaining({ cwd: worktreePath, branch, isolated: true, created: true }));
	});

	test('never refuses a run building in the launching checkout over a branch it does not need', async () => {
		const { config, flags } = setupWorkspace({ flags: ['no-worktree'] });

		const workspace = await resolveRunWorkspace({ cwd: sourceCwd, config, flags, planPath: join('docs', '!!!.md') });

		expect(workspace).toEqual(expect.objectContaining({ cwd: sourceCwd, isolated: false }));
	});

	test('isolates by default when nothing states a preference', async () => {
		const { config, flags } = setupWorkspace();

		const workspace = await resolveRunWorkspace({ cwd: sourceCwd, config, flags, planPath });

		expect(workspace).toEqual(expect.objectContaining({ cwd: worktreePath, branch, isolated: true }));
	});

	test('refuses a branch already checked out and names the checkout holding it', async () => {
		const holder = resolve('/tmp/somebody-elses-checkout');
		const { config, flags } = setupWorkspace({ answers: { holder } });

		const workspace = await resolveRunWorkspace({ cwd: sourceCwd, config, flags, planPath });

		expect(workspace).toEqual({ error: expect.stringContaining(holder) });
		expect(workspace).toEqual({ error: expect.stringContaining('--no-worktree') });
		expect(mockCreateWorktree).not.toHaveBeenCalled();
	});

	test('stops when the default-branch fetch fails', async () => {
		const { config, flags } = setupWorkspace({ answers: { fetched: { error: 'git could not fetch origin: no remote named origin' } } });

		const workspace = await resolveRunWorkspace({ cwd: sourceCwd, config, flags, planPath });

		expect(workspace).toEqual({ error: expect.stringContaining('git could not fetch origin: no remote named origin') });
		expect(mockCreateWorktree).not.toHaveBeenCalled();
	});

	test('never falls back to the launching checkout when creation fails', async () => {
		const { config, flags } = setupWorkspace({ answers: { created: { error: `git could not create a worktree for '${branch}': fatal: invalid reference` } } });

		const workspace = await resolveRunWorkspace({ cwd: sourceCwd, config, flags, planPath });

		expect(workspace).toEqual({ error: expect.stringContaining(`git could not create a worktree for '${branch}': fatal: invalid reference`) });
	});

	test('stops on a failed setup rather than building in an unprepared tree', async () => {
		const { config, flags } = setupWorkspace({ setup: 'pnpm install', answers: { created: { error: `the setup command failed in ${worktreePath}: exit 1` } } });

		const workspace = await resolveRunWorkspace({ cwd: sourceCwd, config, flags, planPath });

		expect(workspace).toEqual({ error: expect.stringContaining(`the setup command failed in ${worktreePath}`) });
		expect(mockCreateWorktree).toHaveBeenCalledWith(expect.objectContaining({ setup: 'pnpm install' }));
		expect(mockLinkRunRecords).not.toHaveBeenCalled();
	});

	test("claims the tree as an implement run's and refuses to reuse one", async () => {
		const { config, flags } = setupWorkspace();

		const workspace = await resolveRunWorkspace({ cwd: sourceCwd, config, flags, planPath });

		expect(workspace).toEqual(expect.objectContaining({ isolated: true, created: true }));
		expect(mockCreateWorktree).toHaveBeenCalledWith(expect.objectContaining({ branch, owner: 'implement', reuseExisting: false }));
	});
});
