import type { PlanningGraphIssue } from '#src/plan/workflow/store/common/types/PlanningGraphIssue.ts';

interface Params {
	values: string[];
	available: Set<string>;
	at: string;
	issues: PlanningGraphIssue[];
}

/** Record every dangling reference rather than stopping at the first one. */
export const requirePlanningIds = ({ values, available, at, issues }: Params): void => {
	for (const value of values) if (!available.has(value)) issues.push({ at, message: `Unknown reference ${value}` });
};
