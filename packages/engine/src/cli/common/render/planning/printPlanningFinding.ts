import type { PlanningFinding } from '#src/contracts/index.ts';

interface Params {
	finding: PlanningFinding;
}

/** Show canonical evidence in its own terms; an unresolved obligation is never an empty legacy gap list. */
export const printPlanningFinding = ({ finding }: Params): void => {
	console.log(`  ${finding.id} [${finding.severity}; ${finding.state}; ${finding.owner}] ${finding.scenario}`);
	console.log(`    consequence: ${finding.consequence}`);
	console.log(`    required: ${finding.missingObligation}`);
	if (finding.proposedResolution) console.log(`    proposed: ${finding.proposedResolution}`);
};
