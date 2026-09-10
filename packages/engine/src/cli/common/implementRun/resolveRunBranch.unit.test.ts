import { describe, expect, test } from '@jest/globals';
import { resolveRunBranch } from '#src/cli/common/implementRun/resolveRunBranch.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';

/** A repo whose `queue` block states a branch template only when a case is about one. */
const setupRepo = ({ branchTemplate }: { branchTemplate?: string } = {}) => {
	const cwd = '/repo';
	const config: LightsoutConfig = {
		gates: { check: 'true', test: 'true', 'test-coverage': false },
		queue: branchTemplate === undefined ? undefined : { 'max-parallel': 3, 'branch-template': branchTemplate },
	};

	return { cwd, config };
};

describe('resolveRunBranch', () => {
	test('names the branch after the plan folder, character for character', () => {
		const { cwd, config } = setupRepo();

		const branch = resolveRunBranch({ cwd, config, planPath: '.lightsout/plans/LO-42-Ship_It' });

		expect(branch).toBe('LO-42-Ship_It');
	});

	test('slugs the file stem when the plan lives outside the plans directory', () => {
		const { cwd, config } = setupRepo();

		const branch = resolveRunBranch({ cwd, config, planPath: 'notes/My Plan Draft.md' });

		expect(branch).toBe('my-plan-draft');
	});

	test('renders the configured branch template from the reference and the ticket heading', () => {
		const { cwd, config } = setupRepo({ branchTemplate: 'feature/{ticket}-{slug}' });

		const branch = resolveRunBranch({
			cwd,
			config,
			ticketPath: 'tickets/lo-9.md',
			ticketRef: 'LO-9',
			ticketBody: '# Add a Worktree by Default\n\nThe run builds in its own tree.\n',
		});

		expect(branch).toBe('feature/lo-9-add-a-worktree-by-default');
	});

	test('falls back to the ticket file stem when no reference was given', () => {
		const { cwd, config } = setupRepo();

		const branch = resolveRunBranch({ cwd, config, ticketPath: 'tickets/LO-9 Add Worktree.md' });

		expect(branch).toBe('lo-9-add-worktree');
	});

	test('refuses an input that names no branch-safe word', () => {
		const { cwd, config } = setupRepo();

		const branch = resolveRunBranch({ cwd, config, planPath: 'notes/???.md' });

		expect(branch).toEqual({ error: expect.stringContaining('???') });
	});
});
