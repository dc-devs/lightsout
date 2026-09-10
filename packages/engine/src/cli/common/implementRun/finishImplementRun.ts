import { printResult } from '#src/cli/common/render/printResult.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { exitAfterImplement } from '#src/cli/common/utils/exitAfterImplement.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';

interface Params {
	/** The config as it was read from disk, before the command stamped its harness on it. */
	config: LightsoutConfig;
	/** The workspace the run built in — the tree the result describes and the branch ship would push. */
	cwd: string;
	result: PipelineResult;
	flags: CommandContext['flags'];
}

/**
 * Print how the run ended, then exit on it — shipping first when the run passed
 * and someone asked for it.
 *
 * Shared by both implement commands rather than written out in each: the two
 * differ in everything up to the pipeline and in nothing after it, and a ship
 * flag honoured by one and not the other would be the kind of split no reader
 * of either file could see.
 */
export const finishImplementRun = async ({ config, cwd, result, flags }: Params): Promise<never> => {
	await printResult({ result, cwd });

	return exitAfterImplement({
		config,
		cwd,
		result,
		shipFlag: flags.get('ship') === true,
		noShipFlag: flags.get('no-ship') === true,
		env: process.env,
	});
};
