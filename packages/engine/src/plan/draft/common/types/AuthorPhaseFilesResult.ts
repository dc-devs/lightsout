import type { PlanDraftReport } from '#src/contracts/plan/draft/PlanDraftReport.ts';
import type { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';

/**
 * How one draft's concurrent phase fan-out came to rest.
 *
 * Shared by both implementations' fan-outs because both return the identical
 * four members and both callers narrow on them identically: two hand-written
 * copies of a four-member union drift the first time either gains a member.
 */
export type AuthorPhaseFilesResult =
	| { status: typeof PlanRunStatus.Complete; planPaths: string[]; reports: PlanDraftReport[] }
	| { status: typeof PlanRunStatus.Failed; error: string }
	| { status: typeof PlanRunStatus.PausedRateLimit; error: string }
	| { status: typeof PlanRunStatus.FactsError; discrepancies: string[] };
