import { commandCatalog } from '#src/commands/commandCatalog.ts';
import type { CommandCatalogEntry } from '#src/contracts/index.ts';

interface Params {
	/** The word after `lightsout`, or the `$command` route param. */
	id: string;
}

/** One catalog entry by id, or undefined when no command answers to it. */
export const getCommandCatalogEntry = ({ id }: Params): CommandCatalogEntry | undefined => commandCatalog.find((entry) => entry.id === id);
