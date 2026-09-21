import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveSharedStateDir } from '#src/common/workspace/resolveSharedStateDir.ts';
import { ticketsDir } from '#src/common/workspace/ticketsDir.ts';
import { PipelineKind } from '#src/contracts/index.ts';
import { getCommandRunsDir } from '#src/runState/common/paths/getCommandRunsDir.ts';
import { getTicketRunsDir } from '#src/runState/common/paths/getTicketRunsDir.ts';

interface Params {
	cwd: string;
}

/**
 * Every directory a run folder may sit in for one repository: one runs folder
 * per ticket, plus one per command.
 *
 * The primary checkout is resolved twice — once through `ticketsDir` and once
 * through `resolveSharedStateDir` — rather than deriving one from the other.
 * Each of those two names is owned by exactly one helper, and recovering the
 * state directory from the tickets directory by walking up would be this file
 * asserting a layout it does not own. The cost is one extra `git rev-parse`
 * per scan, and a scan happens at most twice in a process.
 *
 * A location that is not on disk is still listed: whether a directory is there
 * is the scanner's question, not this one's, and a run created after the list
 * was taken must not be missed because the folder was absent when it was built.
 */
export const listRunLocations = async ({ cwd }: Params): Promise<string[]> => {
	const tickets = await ticketsDir({ cwd });
	const entries = await readdir(tickets, { withFileTypes: true }).catch(() => []);
	const ticketRuns = entries.filter((entry) => entry.isDirectory()).map((entry) => getTicketRunsDir({ ticketFolder: join(tickets, entry.name) }));
	const stateDir = await resolveSharedStateDir({ cwd });
	// Two pipelines share the implement folder, so the set is what keeps the
	// scan from reading it twice.
	const commandRuns = new Set(Object.values(PipelineKind).map((pipeline) => getCommandRunsDir({ stateDir, pipeline })));

	return [...ticketRuns, ...commandRuns];
};
