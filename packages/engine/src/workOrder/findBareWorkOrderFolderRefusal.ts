import { join } from 'node:path';
import { parsePlanAddress } from '#src/common/planAddress/parsePlanAddress.ts';
import { workOrderFolderDir } from '#src/common/workspace/workOrderFolderDir.ts';
import { pathExists } from '#src/plan/index.ts';
import { workOrderFileNames } from '#src/workOrder/common/constants/workOrderFileNames.ts';
import { readWorkOrderState } from '#src/workOrder/readWorkOrderState.ts';

interface Params {
	/** Any checkout of the repository: the one record this machine holds is found from it. */
	cwd: string;
	/** Whatever a command was handed as a plan's name: a plan address, or a folder name on its own. */
	name: string;
}

/**
 * The one rule for when a bare folder name is still a legacy plan: only while
 * the primary checkout holds no work order state for it.
 *
 * A folder that has a record holds plan subfolders rather than a plan, so a
 * bare name there would publish or restore a single-folder generation into it —
 * over a ticket's plans, and around every order check a plan address is subject
 * to. Undefined is the ordinary answer twice over: for a plan address, and for
 * the folder named after its branch alone that every plan carried before ticket
 * records existed.
 *
 * The record file is looked for before the store is asked, because this gate
 * runs on every `plan` subcommand and every `implement` of a plans-directory
 * path — including ones whose plans directory is not a usable directory at all,
 * where "there is no record here" is the answer rather than a reason to stop.
 *
 * Only the local record is read, so no tracker call is made and a fresh machine
 * keeps the legacy route until the record is restored.
 */
export const findBareWorkOrderFolderRefusal = async ({ cwd, name }: Params): Promise<string | undefined> => {
	if (parsePlanAddress({ name }) !== undefined) {
		return undefined;
	}

	const recordPath = join(await workOrderFolderDir({ cwd, name }), workOrderFileNames.record);

	if (!(await pathExists({ path: recordPath }))) {
		return undefined;
	}

	const read = await readWorkOrderState({ cwd, name });

	if ('error' in read) {
		return read.error;
	}

	return read.record === undefined
		? undefined
		: `the plan folder '${name}' belongs to a work order state, so name a plan as '${name}/<plan-id>' — \`lightsout work-order show --name ${name}\` lists the plans it holds`;
};
