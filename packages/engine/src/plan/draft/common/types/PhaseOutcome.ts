import type { PlanDraftReport } from '#src/contracts/index.ts';
import type { AgentOutcome } from '#src/invoke/index.ts';
import type { PhaseDeclaration } from '#src/plan/common/types/PhaseDeclaration.ts';

/**
 * One phase spawn's result, labelled with the declaration row it was authoring.
 *
 * Shared by both implementations' fan-outs for the same reason
 * `AuthorPhaseFilesResult` is: the fold that turns a list of these into that
 * union is one function, so the shape it folds has to be one type.
 */
export interface PhaseOutcome {
	declaration: PhaseDeclaration;
	outcome: AgentOutcome<PlanDraftReport>;
}
