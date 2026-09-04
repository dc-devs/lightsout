import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gitTimeoutMs } from '#src/common/constants/gitTimeoutMs.ts';
import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { runCommand } from '#src/common/processes/runCommand.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import { runOrDescribeFailure } from '#src/queue/common/utils/runOrDescribeFailure.ts';

interface Params {
	/** The worktree holding the work. */
	cwd: string;
	/** The commit subject and body, already written. */
	message: string;
	/** Run directory the message file is written into — inside `.lightsout`, which is gitignored. */
	runDir: string;
	/**
	 * The config's `generated` path prefixes. A change under one of these is
	 * discarded rather than committed: the pre-ship step at merge time is the one
	 * place build output enters history, and it runs after the rebase.
	 */
	generated?: string[];
	/** Live progress sink — one line when generated changes were discarded. */
	onProgress?: (message: string) => void;
}

/**
 * Whether one changed path falls under a configured generated entry.
 *
 * The trailing slash is stripped exactly as the source walk strips it, so a
 * directory prefix (`plugin/dist/`) and a single file
 * (`packages/web-app/src/routeTree.gen.ts`) both work without a second
 * spelling. The boundary is a path segment rather than the walk's bare
 * `startsWith`, deliberately: a walk that skips one extra file only misses a
 * check, while here a bare prefix would delete a source file named
 * `plugin/distortion.ts` before the commit.
 */
const isGeneratedPath = ({ path, generated }: { path: string; generated: string[] }) =>
	generated.some((entry) => {
		const prefix = entry.replace(/\/$/, '');

		return path === prefix || path.startsWith(`${prefix}/`);
	});

/**
 * One path as a git pathspec that means exactly that file.
 *
 * `runCommand` spawns through a shell, so the quoting is not optional, and
 * git's `:(literal)` magic is what stops a real file named `[slug].tsx` being
 * read as a pattern instead of a name.
 */
const toLiteralPathspec = ({ path }: { path: string }) => `':(literal)${path.replaceAll("'", String.raw`'\''`)}'`;

/** One command's worth of pathspecs, each meaning exactly the file it names. */
const toPathspecs = ({ paths }: { paths: string[] }) => paths.map((path) => toLiteralPathspec({ path })).join(' ');

/**
 * Take the generated changes back out of the worktree, so the commit below can
 * carry source only.
 *
 * @returns git's own words when it refused, or undefined once the tree is clean of them
 */
const discardGeneratedChanges = async ({ cwd, paths }: { cwd: string; paths: string[] }) => {
	const pathspecs = toPathspecs({ paths });
	// The index is put back to HEAD first because `git checkout --` restores the
	// worktree FROM the index, and this file's own `git add -A` is what stages
	// the tree: an attempt whose commit was refused parks the ticket with the
	// build output already staged, and a resumed run would otherwise restore that
	// stale copy and commit it.
	const resetFailure = await runOrDescribeFailure({ command: `git reset -q -- ${pathspecs}`, cwd });

	if (resetFailure !== undefined) {
		return resetFailure;
	}

	// This read goes through runCommand rather than runOrDescribeFailure because
	// the split below needs the command's stdout. `--full-name` is deliberately
	// absent: `git ls-files` prints paths relative to the directory it runs in,
	// which is the frame readGitChangedFiles returns, so the two lists compare
	// directly.
	const listed = await runCommand({ command: `git ls-files -z -- ${pathspecs}`, cwd, timeoutMs: gitTimeoutMs }).catch(() => undefined);

	if (listed?.exitCode !== 0) {
		return 'git could not tell which generated paths are tracked';
	}

	const tracked = listed.stdout.split('\0').filter(Boolean);
	const untracked = paths.filter((path) => !tracked.includes(path));
	// Each command is skipped when its side of the split is empty, so neither is
	// ever handed a pathspec it cannot match and no failure has to be tolerated.
	// `git clean` runs without `-x`, which is right: an ignored file could not
	// have reached the commit anyway.
	const commands = [
		...(tracked.length > 0 ? [`git checkout -- ${toPathspecs({ paths: tracked })}`] : []),
		...(untracked.length > 0 ? [`git clean -fdq -- ${toPathspecs({ paths: untracked })}`] : []),
	];

	for (const command of commands) {
		const failure = await runOrDescribeFailure({ command, cwd });

		if (failure !== undefined) {
			return failure;
		}
	}

	return undefined;
};

/**
 * Commit whatever the worker changed, deterministically.
 *
 * The engine never committed before, because a human always did. Under the
 * queue there is nobody there, so the commit is the queue's.
 *
 * A worker's commit carries source changes only. Anything under the config's
 * `generated` entries is discarded from the worktree first: build output
 * committed on a feature branch is a snapshot of the default branch as it was
 * when that branch started, and every later branch then conflicts on a file no
 * human wrote. Committing build output is the pre-ship step's job at merge
 * time, which runs after the rebase and so never has to be rebased.
 *
 * `committed` reports what this commit step did and nothing more. It does not
 * decide whether the branch is ready to merge: readiness is settled from the
 * commits the branch actually carries, so a resumed ticket whose work was
 * committed by an earlier run still ships.
 *
 * The message goes through a file rather than `-m`, so no ticket title needs
 * shell quoting.
 */
export const commitTicketWork = async ({ cwd, message, runDir, generated = [], onProgress }: Params): Promise<{ committed: boolean } | QueueFailure> => {
	const changed = await readGitChangedFiles({ cwd });

	if (changed === undefined) {
		// Never read as "no changes": a commit cannot be promised over a tree
		// that cannot be read.
		return { error: `git could not read the tree at ${cwd}` };
	}

	const generatedPaths = changed.filter((path) => isGeneratedPath({ path, generated }));
	const sourcePaths = changed.filter((path) => !isGeneratedPath({ path, generated }));

	if (generatedPaths.length > 0) {
		const discardFailure = await discardGeneratedChanges({ cwd, paths: generatedPaths });

		if (discardFailure !== undefined) {
			return { error: `git could not discard the generated changes in ${cwd}: ${discardFailure}` };
		}

		onProgress?.(`discarded ${generatedPaths.length} generated path(s) — the pre-ship step commits build output`);
	}

	// The verdict reads the source changes that remain: a run whose only changes
	// were build output has produced nothing to merge, and must be reported that
	// way rather than reaching `git commit` with an empty index.
	if (sourcePaths.length === 0) {
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
