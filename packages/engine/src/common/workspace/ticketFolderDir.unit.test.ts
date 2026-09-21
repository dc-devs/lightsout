import { execSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { ticketFolderDir } from '#src/common/workspace/ticketFolderDir.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/**
 * A primary checkout with a linked worktree cut from it — the shape a ticket
 * command runs in whenever the queue moves a ticket into its own tree, and the
 * one place the worktree's own `.lightsout` could be answered by mistake.
 */
const setupLinkedWorktree = ({ ticketBranch }: { ticketBranch: string }) => {
	const { cwd } = setupBranchRepo();
	const worktree = join(cwd, '.worktrees', ticketBranch);

	execSync(`git worktree add -q -b ${ticketBranch} "${worktree}" main`, { cwd, stdio: 'ignore' });

	return { primary: cwd, worktree };
};

describe('ticketFolderDir', () => {
	test("ticketFolderDir: one branch's folder under the primary checkout's tickets folder", async () => {
		const { primary, worktree } = setupLinkedWorktree({ ticketBranch: 'lo-155-ticket-scoped-state-layout' });

		const ticketFolder = await ticketFolderDir({
			cwd: worktree,
			ticketBranch: 'lo-155-ticket-scoped-state-layout',
		});

		expect({
			root: realpathSync(dirname(dirname(dirname(ticketFolder)))),
			tail: join(basename(dirname(dirname(ticketFolder))), basename(dirname(ticketFolder)), basename(ticketFolder)),
		}).toStrictEqual({
			root: realpathSync(primary),
			tail: join('.lightsout', 'tickets', 'lo-155-ticket-scoped-state-layout'),
		});
	});
});
