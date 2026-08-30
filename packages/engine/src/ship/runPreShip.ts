import { gitTimeoutMs } from '#src/common/constants/gitTimeoutMs.ts';
import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { runCommand } from '#src/common/processes/runCommand.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import type { ShipStepFailure } from '#src/ship/common/types/ShipStepFailure.ts';

interface Params {
	cwd: string;
	/** The configured `pre-ship` command, run as written. */
	command: string;
	/** Live progress sink — one line for the command, one when its changes are committed. */
	onProgress?: (message: string) => void;
}

/** A gate's budget, not a git probe's: a pre-ship command typically rebuilds something. */
const preShipTimeoutMs = 10 * 60_000;

/** The words a failed step hands back: stderr when the process said anything there, else its stdout — build tools report on either. */
const failureWords = ({ stdout, stderr }: { stdout: string; stderr: string }): ShipStepFailure => ({ stderr: stderr.trim() === '' ? stdout : stderr });

/**
 * The repository's own pre-ship convention: run the configured command, then
 * commit whatever it changed.
 *
 * The commit is this step's job rather than the command's, so a repo's script
 * can stay a pure "make the tree right" tool — and so the dirty-tree
 * precondition downstream keeps meaning what it says. A command that changes
 * nothing commits nothing, and that is success: the convention held already.
 */
export const runPreShip = async ({ cwd, command, onProgress }: Params): Promise<ShipStepFailure | undefined> => {
	onProgress?.(`pre-ship: ${command}`);

	const result = await runCommand({ command, cwd, timeoutMs: preShipTimeoutMs }).catch((error: unknown) => ({
		exitCode: 1,
		stdout: '',
		stderr: messageOf({ error }),
	}));

	if (result.exitCode !== 0) {
		return failureWords(result);
	}

	const changed = await readGitChangedFiles({ cwd });

	if (changed === undefined) {
		return { stderr: `git could not read the tree at ${cwd}` };
	}

	if (changed.length === 0) {
		return undefined;
	}

	for (const gitCommand of ['git add -A', "git commit -m 'pre-ship'"]) {
		const committed = await runCommand({ command: gitCommand, cwd, timeoutMs: gitTimeoutMs }).catch((error: unknown) => ({
			exitCode: 1,
			stdout: '',
			stderr: messageOf({ error }),
		}));

		if (committed.exitCode !== 0) {
			return failureWords(committed);
		}
	}

	onProgress?.(`pre-ship: committed ${changed.length} changed file(s)`);

	return undefined;
};
