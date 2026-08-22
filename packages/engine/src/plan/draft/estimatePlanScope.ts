import { type PlanFacts, PlanVariant } from '#src/contracts/index.ts';

interface Params {
	facts: PlanFacts;
	/** `executor-file-limit` from config, already defaulted by the caller. */
	executorFileLimit: number;
}

/**
 * Deterministically estimate whether a plan should be single-file or phased,
 * from the distinct touched paths in the verified facts (`filesToModify` +
 * `patternsToMirror` across all areas). Facts carry no create-paths, so this is
 * a lower bound on the real blast radius — above four fifths of the executor's
 * own file limit (a buffer under the number the implementing agent stops at)
 * the plan is phased. Overridable by the CLI `--scope` flag.
 *
 * It keys off the touched-file limit rather than the created-file ceiling
 * because the facts name no files to create, so a created-file estimate is not
 * available here at all. That is what the draft's single-to-phased escalation
 * exists to catch: a plan estimated as comfortably single can still author forty
 * new files.
 */
export const estimatePlanScope = ({ facts, executorFileLimit }: Params): PlanVariant => {
	const phasedThreshold = Math.floor(executorFileLimit * 0.8);
	const paths = new Set<string>();

	for (const area of facts.areas) {
		for (const file of area.filesToModify) {
			paths.add(file.path);
		}

		for (const pattern of area.patternsToMirror) {
			paths.add(pattern.path);
		}
	}

	return paths.size > phasedThreshold ? PlanVariant.Overview : PlanVariant.Single;
};
