import { readdir } from 'node:fs/promises';
import { workOrderFolderDir } from '#src/common/workspace/workOrderFolderDir.ts';
import { getTicketRunsDir } from '#src/runState/common/paths/getTicketRunsDir.ts';
import { listRunLocations } from '#src/runState/common/paths/listRunLocations.ts';

interface Params {
	cwd: string;
	/** Narrow the read to one ticket's runs folder. Without it, every location a run can sit in. */
	ticketBranch?: string;
}

/**
 * Every run id this repo has state for, sorted — or, given a ticket branch,
 * only the ids in that ticket's own runs folder.
 *
 * Narrowing is what stops listing one plan's runs from reading another plan's:
 * a filter over the whole history still opens every manifest there is. The
 * no-argument call keeps its whole-repo meaning for the three readers that
 * genuinely want it — the runs list, the standards-health decline counts, and
 * the engine's public API.
 *
 * A location that has never held a run is an empty list rather than an error —
 * reports that aggregate across runs must be runnable on a repo with no
 * history.
 */
export const listRunIds = async ({ cwd, ticketBranch }: Params): Promise<string[]> => {
	const locations =
		ticketBranch === undefined ? await listRunLocations({ cwd }) : [getTicketRunsDir({ ticketFolder: await workOrderFolderDir({ cwd, name: ticketBranch }) })];
	const runIds: string[] = [];

	for (const location of locations) {
		const entries = await readdir(location, { withFileTypes: true }).catch(() => []);

		// Only a directory holds a manifest, so stray files are never runs.
		runIds.push(...entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
	}

	return runIds.sort();
};
