import { type LightsoutConfig, PlanningVocabulary } from '#src/contracts/index.ts';
import { resolvePlanningStandards } from '#src/plan/index.ts';

interface Params {
	cwd: string;
	config: LightsoutConfig | undefined;
}

/** Resolve complete authoritative planning guidance; unavailable configured standards must be repaired before authorship. */
export const readPlanningStandards = async ({ cwd, config }: Params): Promise<string | undefined> => {
	const result = await resolvePlanningStandards({
		cwd,
		config,
		role: PlanningVocabulary.Role.Architect,
		scope: { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] },
	});
	return result.content || undefined;
};
