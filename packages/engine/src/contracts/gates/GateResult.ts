import { z } from 'zod';

/**
 * One gate-command execution (or scoped skip) as runGates observed it —
 * the evidence entries handed to its `onGateResult` callback. A crash re-run
 * appears as one further entry per attempt (each with rerun: true); verdicts
 * derive from runGates' aggregate return, never by counting reds here.
 */
export const GateResult = z.object({
	/** Gate kind: 'generate' | 'check' | 'test' | 'testCoverage' | 'build'. */
	kind: z.string(),
	/** 'root' or the package directory name. */
	group: z.string(),
	command: z.string(),
	/** Absent when skipped. -1 = spawn failure or timeout. */
	exitCode: z.number().optional(),
	durationMs: z.number().optional(),
	rerun: z.boolean().optional(),
	/** Present (always `true`) when this red was the known jest worker crash rather than evidence about the code. */
	crashed: z.literal(true).optional(),
	/** Present (always `true`) only on a scoped skip; absent otherwise. */
	skipped: z.literal(true).optional(),
	/** Skip reason, e.g. `no "check" script`. */
	reason: z.string().optional(),
	/** Last 2000 chars of stdout+stderr — present only on non-zero exit. */
	outputTail: z.string().optional(),
});

export type GateResult = z.infer<typeof GateResult>;
