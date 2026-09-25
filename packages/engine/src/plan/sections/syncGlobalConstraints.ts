import type { DecisionsRecord } from '#src/contracts/plan/decisions/DecisionsRecord.ts';
import { generatedPlanRegions } from '#src/plan/common/constants/generatedPlanRegions.ts';
import type { SyncedPlanFile } from '#src/plan/common/types/SyncedPlanFile.ts';
import { renderGlobalConstraints } from '#src/plan/sections/renderGlobalConstraints.ts';
import { writePlanSection } from '#src/plan/sections/writePlanSection.ts';

interface Params {
	/** Absolute paths of the plan files to rewrite — every file of the deliverable. */
	planPaths: string[];
	/** The merged record the constraints are selected from. */
	decisions: DecisionsRecord;
}

/**
 * Regenerate the `## Global Constraints` of every file of one plan deliverable
 * from the saved decision records.
 *
 * Every file gets the same rendered section, which is where this differs from
 * the Decision Log's sync: a history repeated per phase is a history maintained
 * in n places, but a phase file is handed to an implementing agent on its own,
 * so a phase that pointed elsewhere for the rules binding it would be read
 * without them.
 *
 * The caller states its paths; this never resolves a deliverable of its own,
 * for the same reason `syncPlanDecisions` accepts them — the draft flow owns its
 * paths mid-draft, when the folder does not yet resolve to a deliverable.
 */
export const syncGlobalConstraints = async ({ planPaths, decisions }: Params): Promise<SyncedPlanFile[]> => {
	const section = renderGlobalConstraints({ decisions: decisions.decisions });
	const files: SyncedPlanFile[] = [];

	for (const path of planPaths) {
		files.push(
			await writePlanSection({
				path,
				heading: generatedPlanRegions.globalConstraints,
				section,
				after: generatedPlanRegions.decisionLog,
			}),
		);
	}

	return files;
};
