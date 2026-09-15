import type { PlanningRecord, PlanningRoleResult, PlanningWork } from '#src/contracts/index.ts';
import type { PlanningEvidenceContent } from '#src/plan/workflow/common/types/PlanningEvidenceContent.ts';
import type { PlanningInvocation } from '#src/plan/workflow/common/types/PlanningInvocation.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import type { PlanningStandards } from '#src/plan/workflow/common/types/PlanningStandards.ts';

/** One private acceptance candidate; no helper publishes outside the owning CAS transaction. */
export interface PlanningAcceptance {
	runtime: PlanningRuntime;
	current: PlanningSnapshot;
	record: PlanningRecord;
	artifacts: Map<string, string>;
	result: PlanningRoleResult;
	mapped: PlanningRoleResult;
	work: PlanningWork;
	invocation: PlanningInvocation;
	standards: PlanningStandards;
	observations: PlanningEvidenceContent[];
}
