import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import { runOrDescribeFailure } from '#src/queue/common/utils/runOrDescribeFailure.ts';

interface Params {
	/** The worktree holding the work. */
	cwd: string;
	/** The commit subject and body, already written. */
	message: string;
	/** Run directory the message file is written into — inside `.lightsout`, which is gitignored. */
	runDir: string;
}

/**
 * Commit whatever the worker changed, deterministically.
 *
 * The engine never committed before, because a human always did. Under the
 * queue there is nobody there, so the commit is the queue's — and `committed`
 * is on the success shape because "committed the work" and "the worker changed
 * nothing" are two outcomes a caller must never read as one.
 *
 * The message goes through a file rather than `-m`, so no ticket title needs
 * shell quoting.
 */
export const commitTicketWork = async ({ cwd, message, runDir }: Params): Promise<{ committed: boolean } | QueueFailure> => {
	const changed = await readGitChangedFiles({ cwd });

	if (changed === undefined) {
		// Never read as "no changes": a commit cannot be promised over a tree
		// that cannot be read.
		return { error: `git could not read the tree at ${cwd}` };
	}

	if (changed.length === 0) {
		return { committed: false };
	}

	const messagePath = join(runDir, 'commit-message.txt');

	await mkdir(runDir, { recursive: true });
	await writeFile(messagePath, message.endsWith('\n') ? message : `${message}\n`, 'utf8');

	const stageFailure = await runOrDescribeFailure({ command: 'git add -A', cwd });

	if (stageFailure !== undefined) {
		return { error: `git could not stage the work in ${cwd}: ${stageFailure}` };
	}

	const commitFailure = await runOrDescribeFailure({ command: `git commit -F ${messagePath}`, cwd });

	if (commitFailure !== undefined) {
		return { error: `git could not commit the work in ${cwd}: ${commitFailure}` };
	}

	return { committed: true };
};
