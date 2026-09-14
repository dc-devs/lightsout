import { readdir } from 'node:fs/promises';
import { PlanId } from '#src/contracts/index.ts';
import { ticketFileNames } from '#src/ticket/common/constants/ticketFileNames.ts';

interface Params {
	/** The ticket's own folder in the primary checkout, which holds its plan subfolders and its record. */
	ticketFolder: string;
}

/** A plan's own folder, or the copy `ticket sync --keep published` set aside beside it — never a file a single-folder plan left. */
const isPlanFolder = ({ name }: { name: string }) => {
	const setAside = /^(?<planId>.+)\.local-\d+$/.exec(name)?.groups?.planId;

	return PlanId.safeParse(setAside ?? name).success;
};

/** A ticket's own file, including the temporary name the store's atomic write renames from. */
const isTicketFile = ({ name }: { name: string }) =>
	Object.values(ticketFileNames).some((ticketFile) => name === ticketFile || (name.startsWith(`${ticketFile}.`) && name.endsWith('.tmp')));

/**
 * What a ticket folder holds that belongs to a single-folder plan rather than
 * to the ticket: the entries an adoption would move into plan 001.
 *
 * Everything a ticket legitimately keeps at that level is subtracted — a plan's
 * own folder, the copy a kept-published sync moved aside, and the ticket's four
 * files — so what is left is by definition from before ticket records existed.
 * A folder that does not exist holds nothing, which is the ordinary answer for
 * a ticket nobody has started.
 */
export const listLegacyPlanEntries = async ({ ticketFolder }: Params): Promise<string[]> => {
	const entries = await readdir(ticketFolder, { withFileTypes: true }).catch(() => []);

	return entries
		.filter((entry) => !(entry.isDirectory() && isPlanFolder({ name: entry.name })) && !isTicketFile({ name: entry.name }))
		.map((entry) => entry.name)
		.sort();
};
