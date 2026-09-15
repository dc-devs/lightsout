import type { PlanningEvidence } from '#src/contracts/index.ts';

/** Retrieved source bytes paired with their observed dependency contract. */
export interface PlanningEvidenceContent {
	evidence: PlanningEvidence;
	content: string;
	omissions?: Array<{ path: string; kind: string; target?: string }>;
}
