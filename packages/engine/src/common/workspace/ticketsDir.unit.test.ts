import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { ticketsDir } from '#src/common/workspace/ticketsDir.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/**
 * A primary checkout with a linked worktree cut from it — the shape every
 * queued ticket runs in, and the one place two checkouts can disagree about
 * which of them holds the tickets folder.
 */
const setupLinkedWorktree = () => {
	const { cwd } = setupBranchRepo();
	const worktree = join(cwd, '.worktrees', 'lo-155-ticket-scoped-state');

	execSync(`git worktree add -q -b lo-155-ticket-scoped-state "${worktree}" main`, { cwd, stdio: 'ignore' });

	return { primary: cwd, worktree };
};

/** A directory with no repository above it, so git can answer nothing. */
const setupLooseDirectory = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-tickets-dir-'));

	return { cwd };
};

/** A repository that has never had a state directory written into it. */
const setupRepoWithoutState = () => {
	const { cwd } = setupBranchRepo();

	return { cwd };
};

describe('ticketsDir', () => {
	test("ticketsDir: a worktree is answered the primary checkout's tickets folder, and a directory outside any repository its own", async () => {
		const { primary, worktree } = setupLinkedWorktree();
		const { cwd: loose } = setupLooseDirectory();

		const fromWorktree = await ticketsDir({ cwd: worktree });
		const fromLooseDirectory = await ticketsDir({ cwd: loose });

		expect({
			worktreeRoot: realpathSync(dirname(dirname(fromWorktree))),
			worktreeTail: join(basename(dirname(fromWorktree)), basename(fromWorktree)),
			fromLooseDirectory,
		}).toStrictEqual({
			worktreeRoot: realpathSync(primary),
			worktreeTail: join('.lightsout', 'tickets'),
			fromLooseDirectory: join(loose, '.lightsout', 'tickets'),
		});
	});

	test('ticketsDir: naming the folder never creates it', async () => {
		const { cwd } = setupRepoWithoutState();

		const ticketsPath = await ticketsDir({ cwd });

		expect({
			ticketsPath,
			stateDirExists: existsSync(join(cwd, '.lightsout')),
			ticketsPathExists: existsSync(ticketsPath),
		}).toStrictEqual({
			ticketsPath: join(cwd, '.lightsout', 'tickets'),
			stateDirExists: false,
			ticketsPathExists: false,
		});
	});
});
