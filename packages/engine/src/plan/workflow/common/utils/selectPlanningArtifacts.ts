import type { PlanningArtifact, PlanningRecord, PlanningScope } from '#src/contracts/index.ts';
import { planningScopesIntersect } from '#src/plan/workflow/common/utils/planningScopesIntersect.ts';

interface Params {
	record: PlanningRecord;
	scope: PlanningScope;
	claimIds: string[];
}

/** Include selected deliverables and their full execution prerequisite boundary. */
export const selectPlanningArtifacts = ({ record, scope, claimIds }: Params): PlanningArtifact[] => {
	const selected = new Set<PlanningArtifact>();
	const claims = new Set(claimIds);
	const include = ({ artifact }: { artifact: PlanningArtifact }): void => {
		if (selected.has(artifact)) return;
		selected.add(artifact);
		for (const id of artifact.prerequisiteIds) {
			const prerequisite = record.artifacts.find((item) => item.phaseId === id || item.path === id);
			if (prerequisite === undefined) throw new Error(`Planning artifact prerequisite is unavailable: ${id}`);
			include({ artifact: prerequisite });
		}
	};
	for (const artifact of record.artifacts) {
		if (
			planningScopesIntersect({ left: scope, right: artifact.boundaries }) ||
			(artifact.phaseId !== undefined && scope.phaseIds.includes(artifact.phaseId)) ||
			artifact.claimIds.some((id) => claims.has(id))
		)
			include({ artifact });
	}
	return record.artifacts.filter((artifact) => selected.has(artifact));
};
