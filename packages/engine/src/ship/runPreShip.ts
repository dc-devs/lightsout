import { runCommand } from '#src/common/processes/runCommand.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import type { ShipStepFailure } from '#src/ship/common/types/ShipStepFailure.ts';

interface Params {
	cwd: string;
	/** The configured `pre-ship` command, run as written. */
	command: string;
	/** The exact commit the default branch was pinned to, handed to the command so it versions against the base it will merge into. */
	baseCommit?: string;
	/** Live progress sink — one line for the command. Silent when omitted. */
	onProgress?: (message: string) => void;
}

/** The words a failed step hands back: stderr when the process said anything there, else its stdout — build tools report on either. */
const failureWords = ({ stdout, stderr }: { stdout: string; stderr: string }): ShipStepFailure => ({ stderr: stderr.trim() === '' ? stdout : stderr });

/**
 * The repository's own pre-ship convention: run the configured command and
 * leave what it changed in the working tree.
 *
 * It prepares, and it does not commit. The integration owner runs it against
 * the freshly fetched default branch, verifies the whole candidate — the
 * merge, the rebuilt outputs and the bumped version together — and commits
 * only what passed. Committing here would put unverified build output on the
 * branch and, on a retry, a second commit nothing had checked either.
 *
 * `LIGHTSOUT_SHIP_BASE_COMMIT` carries the pinned base to the command, so a
 * repository whose convention compares against a base compares against the one
 * ship actually merged rather than a fork point that has since moved. It is set
 * per invocation, so it overrides whatever the ambient environment holds; a
 * standalone caller that passes none leaves the command its own fallback.
 *
 * Entry cleanliness is `runShip`'s check, made before this ever runs, so
 * everything in the tree afterwards is this command's doing.
 */
export const runPreShip = async ({ cwd, command, baseCommit, onProgress }: Params): Promise<ShipStepFailure | undefined> => {
	onProgress?.(`pre-ship: ${command}`);

	// A gate's budget, not a git probe's: a pre-ship command typically rebuilds something.
	const preShipTimeoutMs = 10 * 60_000;

	const result = await runCommand({
		command,
		cwd,
		timeoutMs: preShipTimeoutMs,
		env: baseCommit === undefined ? undefined : { LIGHTSOUT_SHIP_BASE_COMMIT: baseCommit },
	}).catch((error: unknown) => ({ exitCode: 1, stdout: '', stderr: messageOf({ error }) }));

	return result.exitCode === 0 ? undefined : failureWords(result);
};
