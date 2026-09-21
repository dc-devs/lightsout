import { mkdir } from 'node:fs/promises';
import { planWorkspaceDir } from '#src/plan/index.ts';
import { describeLooseFileNotice } from '#src/ticket/common/planSource/describeLooseFileNotice.ts';
import { moveLooseFilesIntoPlan } from '#src/ticket/common/planSource/moveLooseFilesIntoPlan.ts';
import { rewriteMovedPlanName } from '#src/ticket/common/planSource/rewriteMovedPlanName.ts';
import type { PlanSourceFolder } from '#src/ticket/common/types/PlanSourceFolder.ts';

interface Params {
	/** Any checkout of the repository: the plan's folder is made under the state directory found from it. */
	cwd: string;
	/** The new plan's address, which names its folder and is what the moved records are pointed at. */
	address: string;
	/** The new plan's id, which the notice's sentences name. */
	planId: string;
	/** The source whose loose files fill the folder, or undefined for an add that creates it empty. */
	source: PlanSourceFolder | undefined;
	/** Whether the emptied source may be taken away — never set when the source is the ticket's own folder. */
	retire: boolean;
}

/**
 * Make the new plan's folder, fill it from the source when `--from` named one,
 * and answer the sentences that leaves to tell.
 *
 * It runs after the record change, so the plan legitimately exists whatever it
 * answers: a move that fails is put back by `moveLooseFilesIntoPlan` and becomes
 * a sentence naming where the files still are, and the moved records are only
 * pointed at their new plan once every file arrived.
 */
export const fillPlanFolder = async ({ cwd, address, planId, source, retire }: Params): Promise<string[]> => {
	const planFolder = await planWorkspaceDir({ cwd, name: address });

	await mkdir(planFolder, { recursive: true });

	if (source === undefined) {
		return [];
	}

	const moved = await moveLooseFilesIntoPlan({ plansFolder: source.plansFolder, planFolder, entries: source.entries, retire });
	const rewriteError = moved === undefined ? await rewriteMovedPlanName({ planFolder, address }) : undefined;

	return describeLooseFileNotice({
		address,
		planId,
		hasDeliverable: source.hasDeliverable,
		hasUnfinishedRun: source.hasUnfinishedRun,
		moveError: moved?.error,
		rewriteError,
	});
};
