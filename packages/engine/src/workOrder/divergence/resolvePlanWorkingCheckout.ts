import { dirname } from 'node:path';
import { resolveSharedStateDir } from '#src/common/workspace/resolveSharedStateDir.ts';

interface Params {
	/** Any checkout of the repository the command was launched from. */
	cwd: string;
	name: string;
	planId: string;
}

/**
 * Which checkout on this machine holds the copy of a plan that publishing would
 * send, and which other checkout holds a second copy of it.
 *
 * The sync sidecar is one per machine, so `--keep` has to act on the copies this
 * machine would publish from rather than on whichever checkout the command
 * happened to start in. Every plan folder now lives in the primary checkout
 * whichever checkout a plan command runs in, so the primary is the answer
 * outright and there is never a second copy to report.
 *
 * The shape is kept rather than folded into its two callers: `otherCopies` is
 * part of what `--keep` reports, and the sidecar's one-copy-per-machine
 * reasoning belongs in one place even now that it has one answer.
 */
export const resolvePlanWorkingCheckout = async ({ cwd }: Params): Promise<{ checkout: string; otherCopies: string[] }> => {
	return { checkout: dirname(await resolveSharedStateDir({ cwd })), otherCopies: [] };
};
