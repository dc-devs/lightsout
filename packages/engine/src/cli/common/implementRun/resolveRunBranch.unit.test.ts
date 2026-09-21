import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { resolveRunBranch } from '#src/cli/common/implementRun/resolveRunBranch.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/** A repo whose `queue` block states a branch template only when a case is about one. */
const setupRepo = ({ branchTemplate }: { branchTemplate?: string } = {}) => {
	const cwd = '/repo';
	const config: LightsoutConfig = {
		gates: { check: 'true', test: 'true', 'test-coverage': false },
		queue: branchTemplate === undefined ? undefined : { 'max-parallel': 3, 'branch-template': branchTemplate },
	};

	return { cwd, config };
};

/**
 * A primary checkout with a linked worktree added from it, and a config with no
 * branch template — the shape an implement run takes once a plan command moved
 * the session into a tree. The plan folder is the primary checkout's, so a
 * recorded plan path read from the worktree is the one thing that can stop
 * naming a plan.
 */
const setupWorktreeRepo = () => {
	const { cwd: primary } = setupBranchRepo();
	const worktree = join(primary, '.worktrees', 'lo-7-search');

	execSync(`git worktree add -q -b lo-7-search "${worktree}" main`, { cwd: primary, stdio: 'ignore' });

	const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

	return { worktree, config };
};

describe('resolveRunBranch', () => {
	test('names the branch after the plan folder, character for character', async () => {
		const { cwd, config } = setupRepo();

		const branch = await resolveRunBranch({ cwd, config, planPath: '.lightsout/tickets/LO-42-Ship_It/plans' });

		expect(branch).toBe('LO-42-Ship_It');
	});

	test('names the branch after the ticket folder when the plan lies in a plan subfolder', async () => {
		const { cwd, config } = setupRepo();

		const branch = await resolveRunBranch({ cwd, config, planPath: '.lightsout/tickets/lo-7-search/plans/002-ranking/plan.md' });

		expect(branch).toBe('lo-7-search');
	});

	test('slugs the file stem when the plan lives outside the plans directory', async () => {
		const { cwd, config } = setupRepo();

		const branch = await resolveRunBranch({ cwd, config, planPath: 'notes/My Plan Draft.md' });

		expect(branch).toBe('my-plan-draft');
	});

	test('renders the configured branch template from the reference and the ticket heading', async () => {
		const { cwd, config } = setupRepo({ branchTemplate: 'feature/{ticket}-{slug}' });

		const branch = await resolveRunBranch({
			cwd,
			config,
			ticketPath: 'tickets/lo-9.md',
			ticketRef: 'LO-9',
			ticketBody: '# Add a Worktree by Default\n\nThe run builds in its own tree.\n',
		});

		expect(branch).toBe('feature/lo-9-add-a-worktree-by-default');
	});

	test('falls back to the ticket file stem when no reference was given', async () => {
		const { cwd, config } = setupRepo();

		const branch = await resolveRunBranch({ cwd, config, ticketPath: 'tickets/LO-9 Add Worktree.md' });

		expect(branch).toBe('lo-9-add-worktree');
	});

	test('refuses an input that names no branch-safe word', async () => {
		const { cwd, config } = setupRepo();

		const branch = await resolveRunBranch({ cwd, config, planPath: 'notes/???.md' });

		expect(branch).toEqual({ error: expect.stringContaining('???') });
	});

	test('a plans-directory plan path still answers its ticket branch when resolved from a linked worktree', async () => {
		const { worktree, config } = setupWorktreeRepo();

		const branch = await resolveRunBranch({ cwd: worktree, config, planPath: '.lightsout/tickets/lo-7-search/plans/002-ranking/plan.md' });

		// 'plan' is what the file stem gives once the path stops naming a plan,
		// so the ticket folder's own name is what proves it still does
		expect(branch).toBe('lo-7-search');
	});
});
