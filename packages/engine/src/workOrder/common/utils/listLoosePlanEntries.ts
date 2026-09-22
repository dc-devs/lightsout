import { readdir } from 'node:fs/promises';
import { PlanId } from '#src/contracts/index.ts';

interface Params {
	/** The ticket's plans folder in the primary checkout, which holds its plan subfolders. */
	plansFolder: string;
}

/** A plan's own folder, or the copy `ticket sync --keep published` set aside beside it — never one of the folder's loose files. */
const isPlanFolder = ({ name }: { name: string }) => {
	const setAside = /^(?<planId>.+)\.local-\d+$/.exec(name)?.groups?.planId;

	return PlanId.safeParse(setAside ?? name).success;
};

/**
 * What a ticket's plans folder holds that belongs to no plan of it — its loose
 * files, whenever they were written: the entries a `--from` add moves into the
 * plan it makes.
 *
 * Only a plan's own folder and the copy a kept-published sync moved aside are
 * subtracted, so what is left is everything the folder holds in its own right.
 * Nothing else needs a rule: the work order's state files sit one level up and its
 * `runs/` folder beside this one, so neither can appear here. A folder that does
 * not exist holds nothing, which is the ordinary answer for a ticket nobody has
 * started.
 */
export const listLoosePlanEntries = async ({ plansFolder }: Params): Promise<string[]> => {
	const entries = await readdir(plansFolder, { withFileTypes: true }).catch(() => []);

	return entries
		.filter((entry) => !(entry.isDirectory() && isPlanFolder({ name: entry.name })))
		.map((entry) => entry.name)
		.sort();
};
