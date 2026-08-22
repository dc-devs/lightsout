import type { StructuralFinding } from '#src/contracts/index.ts';
import type { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';

/**
 * How a bounded plan-repair loop came to rest: the surviving findings — empty
 * when it converged, advisories included so the caller can print them — or the
 * reason there are none, a dead spawn or the harness rate-limit wall.
 *
 * One shape for every such loop, because a caller that handles the structural
 * repair handles the phase-breakdown reshape identically, and two hand-spelled
 * copies of a status union are two chances for one to gain a member the other
 * never learns to handle.
 */
export type PlanRepairResult =
	| { status: typeof PlanRunStatus.Complete; findings: StructuralFinding[] }
	| { status: typeof PlanRunStatus.Failed; error: string }
	| { status: typeof PlanRunStatus.PausedRateLimit; error: string };
