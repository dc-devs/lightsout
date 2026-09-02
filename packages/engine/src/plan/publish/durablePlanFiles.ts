import { basename, join } from 'node:path';
import { durablePlanFileNames } from '#src/plan/common/constants/durablePlanFileNames.ts';
import { pathExists } from '#src/plan/common/paths/pathExists.ts';
import type { DurablePlanFile } from '#src/plan/common/types/DurablePlanFile.ts';
import { resolvePlanDeliverable } from '#src/plan/common/utils/resolvePlanDeliverable.ts';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
}

interface DurableSet {
	files: DurablePlanFile[];
	/** Set when the folder holds no plan deliverable — the one thing nothing can be implemented without. */
	error?: string;
}

/**
 * Resolve one plan folder to the files that travel, in the order they are
 * attached.
 *
 * What a plan *is* is answered by `resolvePlanDeliverable` and nowhere else, so
 * a phased plan's overview and every phase file travel without this file ever
 * restating the naming rule. The working records follow, each kept only when
 * the folder holds it: `notes.md` exists only when verify-facts was given
 * `--notes`, so requiring it would refuse a legitimate plan.
 *
 * `DurableSet` is declared here and not exported, the way
 * `resolvePlanDeliverable` declares its own: no caller names the wrapper. The
 * file shape inside it is another matter — publish names it too, so it lives in
 * `common/types/` where both can reach it.
 */
export const durablePlanFiles = async ({ cwd, name }: Params): Promise<DurableSet> => {
	const deliverable = await resolvePlanDeliverable({ cwd, name });

	if (deliverable.error !== undefined) {
		return { files: [], error: `nothing to publish for '${name}': ${deliverable.error}` };
	}

	const isSinglePlan = deliverable.files.length === 1 && basename(deliverable.files[0]?.path ?? '') === 'plan.md';

	if (!isSinglePlan && deliverable.overviewPath === undefined) {
		return {
			files: [],
			error: `nothing to publish for '${name}': phase files need an overview.md so the restored folder is a runnable phased plan`,
		};
	}

	const dir = planWorkspaceDir({ cwd, name });
	const deliverablePaths = deliverable.overviewPath === undefined ? [] : [deliverable.overviewPath];
	// The resolver already sorts the phase files, so the attachment order is the
	// reading order.
	const files: DurablePlanFile[] = [...deliverablePaths, ...deliverable.files.map((file) => file.path)].map((path) => ({ name: basename(path), path }));

	for (const record of durablePlanFileNames.records) {
		const path = join(dir, record);

		if (await pathExists({ path })) {
			files.push({ name: record, path });
		}
	}

	return { files };
};
