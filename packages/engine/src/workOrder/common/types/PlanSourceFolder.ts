import type { PlanProgress } from '#src/contracts/index.ts';

/**
 * The folder a `--from` add is made out of, as every refusal about it has
 * already been settled.
 *
 * Exported because `resolvePlanSourceFolder` is, and an exported function's
 * return type is the output half of its contract.
 */
export interface PlanSourceFolder {
	/** The source's plans folder in the primary checkout, which holds the loose files. */
	plansFolder: string;
	/** The loose entries to move, in the order `listLoosePlanEntries` answered them. */
	entries: string[];
	/** How far the source's implementation got, as the new plan's progress. */
	progress: PlanProgress;
	/** Whether the source holds a plan deliverable, which the publish sentence turns on. */
	hasDeliverable: boolean;
	/** Whether any of the source's own runs did not pass, which the resume sentence turns on. */
	hasUnfinishedRun: boolean;
}
