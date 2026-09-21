import { readdir } from 'node:fs/promises';
import { PlanId } from '#src/contracts/index.ts';

interface Params {
	/** The ticket's plans folder in the primary checkout, which holds its plan subfolders. */
	plansFolder: string;
}

/** A plan's own folder, or the copy `ticket sync --keep published` set aside beside it — never a file a single-folder plan left. */
const isPlanFolder = ({ name }: { name: string }) => {
	const setAside = /^(?<planId>.+)\.local-\d+$/.exec(name)?.groups?.planId;

	return PlanId.safeParse(setAside ?? name).success;
};

/**
 * What a ticket's plans folder holds that belongs to a single-folder plan
 * rather than to the ticket: the entries an adoption would move into plan 001.
 *
 * Only a plan's own folder and the copy a kept-published sync moved aside are
 * subtracted, so what is left is by definition from before ticket records
 * existed. Nothing else needs a rule: the ticket's record files sit one level
 * up and its `runs/` folder beside this one, so neither can appear here. A
 * folder that does not exist holds nothing, which is the ordinary answer for a
 * ticket nobody has started.
 */
export const listLegacyPlanEntries = async ({ plansFolder }: Params): Promise<string[]> => {
	const entries = await readdir(plansFolder, { withFileTypes: true }).catch(() => []);

	return entries
		.filter((entry) => !(entry.isDirectory() && isPlanFolder({ name: entry.name })))
		.map((entry) => entry.name)
		.sort();
};
