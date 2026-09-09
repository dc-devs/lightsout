interface Params {
	/** A ref, a commit or a path — data, never syntax. */
	argument: string;
}

/**
 * One argument, safe to hand a shell: wrapped in single quotes, with any single
 * quote of its own closed and re-opened around an escaped one.
 *
 * Git commands here run through a shell, and a branch name or a path is data —
 * `readGitCommittedFile` quotes for the same reason, and a conflicted path may
 * carry quotes, spaces and shell metacharacters that must never execute.
 */
export const quoteGitArgument = ({ argument }: Params): string => `'${argument.split("'").join(`'\\''`)}'`;
