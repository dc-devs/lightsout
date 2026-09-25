import type { GateRunResult } from '#src/gates/common/types/GateRunResult.ts';

interface Params {
	/** The results to fold into one — a stage's groups, or a checkpoint's stages. */
	results: GateRunResult[];
}

/**
 * One aggregate result from several: across the groups of a stage, and across
 * the stages of a checkpoint.
 *
 * The channels keep their meanings — `error` is the whole output a caller reads
 * as the reason the run stopped, `failedFamilies` is what a fix agent is asked
 * to repair, `crashes` is the red that is a toolchain fault, and `timeouts` is
 * the red that is a gate running past its ceiling.
 */
export const mergeGateRunResults = ({ results }: Params): GateRunResult => {
	const errors = results.flatMap((result) => (result.error === undefined ? [] : [result.error]));

	return {
		error: errors.length > 0 ? errors.join('\n\n') : undefined,
		failedFamilies: [...new Set(results.flatMap((result) => result.failedFamilies))],
		crashes: results.flatMap((result) => result.crashes),
		timeouts: results.flatMap((result) => result.timeouts),
		// A constant rather than a fold: the inputs here are the groups of a stage
		// and the stages of a checkpoint, and the reservation is taken around the
		// whole schedule — so no input this is ever given can carry a coordination
		// reason, and folding one would be a branch no test could reach.
		coordination: undefined,
	};
};
