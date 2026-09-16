import type { PlanningArtifact, PlanningInput, PlanningOrigin } from '#src/contracts/index.ts';

/** Exact legacy bytes accompany foreground assertions; parsing never rewrites the captured originals. */
export interface PlanningImportInputs {
	input: PlanningInput;
	artifacts: Array<{ descriptor: PlanningArtifact; content: string }>;
	legacyDecisions?: Array<{ path: string; content: string }>;
	legacyFindings?: { path: string; content: string };
	sources?: PlanningOrigin[];
}
