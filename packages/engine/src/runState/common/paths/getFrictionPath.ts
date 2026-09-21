import { join } from 'node:path';
import { resolveSharedStateDir } from '#src/common/workspace/resolveSharedStateDir.ts';

interface Params {
	/** Any checkout of the repository; the primary is resolved from it. */
	cwd: string;
}

/**
 * One append-only friction log per consumer repo, at the top of the state
 * directory the primary checkout holds: `<primary>/.lightsout/friction.jsonl`.
 *
 * It is not keyed by branch and does not move into a ticket folder — every run
 * of the repository appends to the one ledger, which is what lets the
 * improvement loop see patterns rather than one run's view of them.
 */
export const getFrictionPath = async ({ cwd }: Params): Promise<string> => {
	return join(await resolveSharedStateDir({ cwd }), 'friction.jsonl');
};
