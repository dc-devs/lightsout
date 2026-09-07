import type { GateResult } from '#src/contracts/index.ts';
import type { GateRunResult } from '#src/gates/index.ts';

/**
 * What one run of a checkpoint's gates answered — the verdict every repair stage
 * passes along.
 *
 * Declared here, at the lowest folder both `runVerificationGates` and the verify
 * step can reach, rather than derived from the function's return type in the
 * step that consumes it: a shape read back out of a `ReturnType` is owned by
 * nobody, so a change in one module silently reshapes a type declared in the
 * other.
 */
export interface VerificationResult extends GateRunResult {
	/** The red gates the step shows and the fix role reads — a crashed gate is deliberately absent. */
	failures: GateResult[];
	/**
	 * Every gate this checkpoint observed, which the acceptance check and the
	 * clean-slate probe read their evidence back from. Absent on a verdict
	 * reached before the gates ran at all — a refused test-change review — because
	 * a checkpoint that spent no gate observed none.
	 */
	gates?: GateResult[];
}
