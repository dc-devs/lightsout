import { join } from 'node:path';
import { getRunDir } from '#src/runState/index.ts';

interface Params {
	cwd: string;
	runId: string;
	/** Repo-relative path of the ledger test file. */
	path: string;
}

/**
 * Where the run keeps its locked copy of one ledger test file:
 * `<repo>/.lightsout/runs/<runId>/ledger/<repo-relative path>`.
 *
 * One function, so the step that takes the copy and the check that restores it
 * can never disagree about where it is.
 */
export const ledgerCopyPath = ({ cwd, runId, path }: Params): string => {
	return join(getRunDir({ cwd, runId }), 'ledger', path);
};
