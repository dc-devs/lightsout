import { join } from 'node:path';

interface Params {
	/** The ticket's own folder, as `workOrderFolderDir` names it. */
	ticketFolder: string;
}

/**
 * One ticket's runs folder, holding every run of every plan on that ticket:
 * `<ticket folder>/runs`.
 *
 * It takes the already-resolved ticket folder rather than a branch name because
 * `workOrderFolderDir` owns the spelling of where a ticket folder is, and a helper
 * that re-derived it would put that spelling in two files that drift the moment
 * either is edited.
 */
export const getTicketRunsDir = ({ ticketFolder }: Params): string => join(ticketFolder, 'runs');
