import { runInRepo } from '#tests/helpers/runInRepo.ts';

/**
 * A merge left open in the index, under a fixed identity so the fixture needs
 * no git config of its own — the same bargain `commitAll` makes.
 *
 * The identity is required despite `--no-commit`: git validates the committer
 * before it starts the merge, not when it writes a commit, so a machine with no
 * `user.name` refuses here even though nothing is committed. A developer
 * machine has one and passes; a CI runner does not and fails.
 */
export const mergeWithoutCommitting = ({ cwd, commit }: { cwd: string; commit: string }): void => {
	runInRepo({ cwd, command: 'git', args: ['-c', 'user.name=t', '-c', 'user.email=t@t', 'merge', '--no-commit', '--no-ff', commit] });
};
