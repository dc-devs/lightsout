import type { CommandCatalogEntry, RunListing } from '@lightsout/engine';
import { commandRunValues } from '#src/features/commands/common/constants/commandRunValues.ts';
import { filterRuns, foldPhaseChildren, type RunFilters } from '#src/features/runs/index.ts';

interface Params {
	entry: CommandCatalogEntry;
	runs: RunListing[];
}

/**
 * This command's runs, grouped exactly as its history table shows them:
 * narrowed to the run values `commandRunValues` gives the command, then with
 * each coordinator's phase children folded under it.
 *
 * The card's count and the command's own table both come through here, which is
 * what makes `commandRunValues`' promise true — deriving the grouping at each
 * surface would let one of them change and print a different number from the
 * other.
 *
 * `runIds` is in the listing's own order, not the table's: the table sorts for
 * itself, and a caller wanting a handful of rows takes them off the front.
 */
export const getCommandRuns = ({ entry, runs }: Params): { filters: RunFilters; runIds: string[]; latestAt?: string } => {
	const filters: RunFilters = { commands: commandRunValues[entry.id] ?? [], statuses: [] };
	const groups = foldPhaseChildren({ runs: filterRuns({ runs, filters }) });
	const updatedAts = groups.map(({ run }) => run.updatedAt).sort();

	return { filters, runIds: groups.map(({ run }) => run.runId), latestAt: updatedAts[updatedAts.length - 1] };
};
