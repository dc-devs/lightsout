import type { PlanningRecord } from '#src/contracts/index.ts';
import type { PlanningGraphIssue } from '#src/plan/workflow/store/common/types/PlanningGraphIssue.ts';

/** Shared index for deterministic reference validation. */
export interface PlanningGraphContext {
	record: PlanningRecord;
	issues: PlanningGraphIssue[];
	ids: Set<string>;
	claims: Set<string>;
	phases: Set<string>;
	work: Set<string>;
	findings: Set<string>;
	receipts: Set<string>;
}
