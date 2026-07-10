import { z } from 'zod';

/**
 * One gate-command execution (or scoped skip) as runGates observed it —
 * evidence entries for VerifyReport.gates. A flake re-run appears as two
 * entries (the second with rerun: true); verdicts derive from runGates'
 * aggregate return, never by counting reds here.
 */
export const GateResult = z.object({
	/** Gate kind: 'generate' | 'check' | 'testUnit' | 'testCoverage' | 'build'. */
	kind: z.string(),
	/** 'root' or the package directory name. */
	group: z.string(),
	command: z.string(),
	/** Absent when skipped. -1 = spawn failure or timeout. */
	exitCode: z.number().optional(),
	durationMs: z.number().optional(),
	rerun: z.boolean().optional(),
	/** Present (always `true`) only on a scoped skip; absent otherwise. */
	skipped: z.literal(true).optional(),
	/** Skip reason, e.g. `no "check" script`. */
	reason: z.string().optional(),
	/** Last 2000 chars of stdout+stderr — present only on non-zero exit. */
	outputTail: z.string().optional(),
});

export type GateResult = z.infer<typeof GateResult>;
