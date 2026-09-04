import type { Effort, Permissions } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';

/**
 * Everything one `plan grade` pass was asked for. Named rather than left as
 * `runPlanGrade`'s local `Params` because the agent half of the grade is handed
 * the whole object unchanged, and a hand-copied shape there would be a shadow
 * contract that drifts.
 */
export interface PlanGradeParams {
	cwd: string;
	driver: Driver;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
	/** Gap-check only these plan files — a bare phase number (`3`) or a full basename. Absent → all of them; narrowed → always incomplete. */
	phases?: string[];
	/** Supplemental code standards, threaded into the gap-check so standards-conflict can fire. */
	standards?: string;
	model?: string;
	effort?: Effort;
	permissions?: Permissions;
	timeoutMs?: number;
	onProgress?: (message: string) => void;
}
