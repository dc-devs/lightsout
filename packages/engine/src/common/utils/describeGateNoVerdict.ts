import type { GateRunResult } from '#src/gates/index.ts';

interface Params {
	result: GateRunResult;
}

/**
 * The stop reason for a gate run that reached no verdict about the code — it
 * never got the machine, a gate crashed, or a gate ran past its own ceiling.
 *
 * Written once because four settles stop on it the same way: the refactor
 * batch's settle and supervisor stage, the coverage batch's settle and the
 * shared pre-flight baseline. None of them may spend a fix on such a run, and
 * none may call it red, because no gate command here returned a verdict.
 *
 * The checks run coordination, then crash, then timeout, so one run carrying
 * both a crash and a timeout names the crash first; the full gate output rides
 * beside it and still names the other gate.
 *
 * @returns the stop reason, or undefined when the result is a verdict — green, or a red a fix may be spent on
 */
export const describeGateNoVerdict = ({ result }: Params): string | undefined => {
	let reason: string | undefined;

	if (result.coordination !== undefined) {
		reason = result.coordination;
	} else if (result.crashes.length > 0) {
		reason = [result.crashes.join('\n'), 'No fix attempt was spent: a gate that crashed returned no verdict about the code.', result.error ?? ''].join('\n\n');
	} else if (result.timeouts.length > 0) {
		reason = [
			result.timeouts.join('\n'),
			'No fix attempt was spent: a gate that ran past its ceiling returned no verdict about the code.',
			result.error ?? '',
		].join('\n\n');
	}

	return reason;
};
