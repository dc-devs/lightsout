import { type PlanningArtifact, type PlanningRecord, PlanningVocabulary } from '#src/contracts/index.ts';

interface Params {
	record: PlanningRecord;
}

/** Stable topological phase order derives from identities and prerequisites, never filename numbering. */
export const orderPlanningPhases = ({ record }: Params): PlanningArtifact[] => {
	const phases = record.artifacts.filter((artifact) => artifact.variant === PlanningVocabulary.Artifact.Phase);
	const ordered: PlanningArtifact[] = [];
	const remaining = [...phases];
	const seen = new Set<string>();
	if (phases.some((phase) => !phase.phaseId) || new Set(phases.map((phase) => phase.phaseId)).size !== phases.length)
		throw new Error('Planning phases require unique stable identities');
	while (remaining.length > 0) {
		const index = remaining.findIndex((phase) => phase.prerequisiteIds.every((id) => seen.has(id)));
		if (index < 0) throw new Error('Planning phase prerequisites are missing or cyclic');
		const phase = remaining.splice(index, 1)[0];
		if (!phase.phaseId) throw new Error('Planning phase identity disappeared');
		ordered.push(phase);
		seen.add(phase.phaseId);
	}
	return ordered;
};
