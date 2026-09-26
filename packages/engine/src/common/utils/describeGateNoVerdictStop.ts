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
 * What an operator is told when a gate crashed or timed out instead of failing.
 * Shared by the implement pipeline and the direct run. A crash is named first.
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
