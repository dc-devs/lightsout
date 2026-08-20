import { type PlanFacts, PlanVariant } from '#src/contracts/index.ts';

interface Params {
	facts: PlanFacts;
}

/**
 * Deterministically estimate whether a plan should be single-file or phased,
 * from the distinct touched paths in the verified facts (`filesToModify` +
 * `patternsToMirror` across all areas). Facts carry no create-paths, so this is
 * a lower bound on the real blast radius — above the 40-file threshold (a buffer
 * under the executor's 50-file guardrail) the plan is phased. Overridable by the
 * CLI `--scope` flag.
 */
export const estimatePlanScope = ({ facts }: Params): PlanVariant => {
	// Buffer under the 50-file executor guardrail — above this the plan goes phased.
	const phasedThreshold = 40;
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
