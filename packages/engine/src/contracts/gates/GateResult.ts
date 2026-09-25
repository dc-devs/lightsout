import { z } from 'zod';

/** One gate-command execution, or scoped skip, as runGates saw it. Each re-run is its own entry. */
export const GateResult = z.object({
	/** Gate kind: 'generate' | 'check' | 'test' | 'testCoverage' | 'build'. */
	kind: z.string(),
	/** 'root' or the package directory name. */
	group: z.string(),
	command: z.string(),
	/** Absent when skipped. -1 = spawn failure or timeout; `timedOut` tells the two apart. */
	exitCode: z.number().optional(),
	durationMs: z.number().optional(),
	rerun: z.boolean().optional(),
	/** Present (always `true`) when this red was a test runner that died without reporting a failing test, rather than evidence about the code. */
	crashed: z.literal(true).optional(),
	/** Present (always `true`) when this attempt was stopped by the gate ceiling rather than returning an exit code. */
	timedOut: z.literal(true).optional(),
	/** Present (always `true`) only on a scoped skip; absent otherwise. */
	skipped: z.literal(true).optional(),
	/** Skip reason, e.g. `no "check" script`. */
	reason: z.string().optional(),
	/** Last 2000 chars of stdout+stderr — present only on non-zero exit. */
	outputTail: z.string().optional(),
	/** Repo-relative directory this execution's per-test results were written to. */
	testResultsDir: z.string().optional(),
});

export type GateResult = z.infer<typeof GateResult>;
