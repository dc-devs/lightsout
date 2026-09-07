import { z } from 'zod';
import { GradeFindingRecord } from '#src/contracts/plan/memory/GradeFindingRecord.ts';
import { GradeInputs } from '#src/contracts/plan/memory/GradeInputs.ts';
import { GradeScope } from '#src/contracts/plan/memory/GradeScope.ts';

/**
 * The persisted `grade-memory.json`: a plan's settled decisions, and what the
 * last pass and the last qualifying full review measured.
 *
 * It is a separate file from `grade.json` because the two answer different
 * questions. `grade.json` is overwritten every pass and holds the latest
 * verdict; this is the state that crosses passes, so it is written once per pass
 * and travels with a published plan.
 */
export const GradeMemory = z.object({
	planName: z.string(),
	findings: z.array(GradeFindingRecord).default([]),
	/** What the previous pass measured, whatever its scope — the baseline the edited-phase comparison reads. Absent on a fresh memory. */
	lastPass: z.object({ scope: z.enum(GradeScope), inputs: GradeInputs, at: z.string() }).optional(),
	/** The most recent complete, passing, full review — what the reuse short-circuit compares the current fingerprint against. */
	lastPassingFullReview: z.object({ inputs: GradeInputs, at: z.string() }).optional(),
	/** The `<N>` the next `f<N>` id takes. Monotonic, so a deleted record's id is never handed out again. */
	nextFindingNumber: z.number().int().default(1),
	updatedAt: z.string(),
});

export type GradeMemory = z.infer<typeof GradeMemory>;
