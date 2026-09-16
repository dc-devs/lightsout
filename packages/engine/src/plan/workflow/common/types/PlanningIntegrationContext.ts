import type { PlanningDependency } from '#src/contracts/index.ts';

/** Semantic integration inputs exclude the integration invocation's own receipt and lease bookkeeping. */
export interface PlanningIntegrationContext {
	digest: string;
	content: string;
	dependencies: PlanningDependency[];
}
