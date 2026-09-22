import { execSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { workOrderFolderDir } from '#src/common/workspace/workOrderFolderDir.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/**
 * A primary checkout with a linked worktree cut from it — the shape a work
 * order command runs in whenever the queue moves a work order into its own
 * tree, and the one place the worktree's own `.lightsout` could be answered by
 * mistake.
 */
const setupLinkedWorktree = ({ branch }: { branch: string }) => {
	const { cwd } = setupBranchRepo();
	const worktree = join(cwd, '.worktrees', branch);

	execSync(`git worktree add -q -b ${branch} "${worktree}" main`, { cwd, stdio: 'ignore' });

	return { primary: cwd, worktree };
};

describe('workOrderFolderDir', () => {
	test("workOrderFolderDir: one work order's folder under the primary checkout, keyed by its label", async () => {
		const { primary, worktree } = setupLinkedWorktree({ branch: 'lo-158-work-order-state' });

		const workOrderFolder = await workOrderFolderDir({
			cwd: worktree,
			name: 'lo-158-work-order-state',
		});

		expect({
			root: realpathSync(dirname(dirname(dirname(workOrderFolder)))),
			stateDir: basename(dirname(dirname(workOrderFolder))),
			label: basename(workOrderFolder),
		}).toStrictEqual({
			root: realpathSync(primary),
			stateDir: '.lightsout',
			label: 'lo-158-work-order-state',
		});
	});

	test("workOrderFolderDir: one label's folder under the primary checkout's shared state folder", async () => {
		const { primary, worktree } = setupLinkedWorktree({ branch: 'lo-155-ticket-scoped-state-layout' });

		const workOrderFolder = await workOrderFolderDir({
			cwd: worktree,
			name: 'lo-155-ticket-scoped-state-layout',
		});

		expect({
			root: realpathSync(dirname(dirname(dirname(workOrderFolder)))),
			tail: join(basename(dirname(dirname(workOrderFolder))), basename(dirname(workOrderFolder)), basename(workOrderFolder)),
		}).toStrictEqual({
			root: realpathSync(primary),
			tail: join('.lightsout', 'tickets', 'lo-155-ticket-scoped-state-layout'),
		});
	});
});
