import type { GateRunResult } from '#src/gates/common/types/GateRunResult.ts';

interface Params {
	/** The results to fold into one — a stage's groups, or a checkpoint's stages. */
	results: GateRunResult[];
}

/**
 * One aggregate result from several: across the groups of a stage, and across
 * the stages of a checkpoint.
 *
 * The three channels keep their meanings — `error` is the whole output a caller
 * reads as the reason the run stopped, `failedFamilies` is what a fix agent is
 * asked to repair, and `crashes` is the red that is a toolchain fault.
 */
export const mergeGateRunResults = ({ results }: Params): GateRunResult => {
	const errors = results.flatMap((result) => (result.error === undefined ? [] : [result.error]));

	return {
		error: errors.length > 0 ? errors.join('\n\n') : undefined,
		failedFamilies: [...new Set(results.flatMap((result) => result.failedFamilies))],
		crashes: results.flatMap((result) => result.crashes),
	};
};
