import { jestCrashCause } from '#src/common/constants/jestCrashCause.ts';

interface Params {
	/** The verification step the gate run belonged to. */
	stepId: string;
	/** One line per gate that crashed on every attempt — `runGates`' `crashes`. */
	crashes: string[];
	/** One line per gate that ran past its ceiling on every attempt — `runGates`' `timeouts`. */
	timeouts: string[];
}

/**
 * What an operator is told when a step's gates ran but a gate crashed, or ran
 * past its own time ceiling, instead of failing — neither is a verdict about
 * the code, so nothing here was repaired.
 *
 * Written once because two pipelines end on this condition — the implement
 * pipeline's verification steps and the direct run's verify — and they end it
 * through different run types. Only the sentences are shared: were each to spell
 * its own, an edit to one would leave the two telling an operator something
 * different about the same gate.
 *
 * Called only once the gate run carried a crash or a timeout. A crash is named
 * first when it carried both; the gate output a caller appends still names the
 * other gate. Callers append that output, which is evidence a human reads
 * rather than part of this promise.
 *
 * @returns what the gate did in place of failing ("crashed" or "timed out"), for the caller's progress line, and the stop reason
 */
export const describeGateNoVerdictStop = ({ stepId, crashes, timeouts }: Params): { ending: string; reason: string } =>
	crashes.length > 0
		? {
				ending: 'crashed',
				reason: [
					`${stepId}: a gate crashed instead of failing — not a verdict about the code.`,
					jestCrashCause,
					'No fix was attempted and no fix attempt was spent.',
					crashes.join('\n'),
				].join('\n\n'),
			}
		: {
				ending: 'timed out',
				reason: [
					`${stepId}: a gate ran past its own time ceiling (timeouts.gate-minutes) — not a verdict about the code.`,
					'No fix was attempted and no fix attempt was spent; re-running the run, or raising timeouts.gate-minutes, is the answer.',
					timeouts.join('\n'),
				].join('\n\n'),
			};
