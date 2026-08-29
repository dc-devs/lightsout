import { gitTimeoutMs } from '#src/common/constants/gitTimeoutMs.ts';
import { runCommand } from '#src/common/processes/runCommand.ts';

interface Params {
	command: string;
	cwd: string;
	/** Defaults to the git ceiling, which is what almost every queue step runs under. */
	timeoutMs?: number;
	/** What to call the thing that ran, for the case where it never answered at all. */
	subject?: string;
}

/**
 * Run one command and answer only whether it worked.
 *
 * Every git step the queue takes cares about the same two things — a non-zero
 * exit, and a process that never answered at all — and each one states the
 * failure as a sentence of its own. This puts the reading of that failure in
 * one place, so the caller writes only the half a human needs: what it was
 * trying to do.
 *
 * @returns the command's trimmed stderr when it failed, or `undefined` when it worked
 */
export const runOrDescribeFailure = async ({ command, cwd, timeoutMs = gitTimeoutMs, subject = 'git' }: Params): Promise<string | undefined> => {
	const result = await runCommand({ command, cwd, timeoutMs }).catch(() => undefined);

	return result?.exitCode === 0 ? undefined : (result?.stderr ?? `${subject} did not answer`).trim();
};
