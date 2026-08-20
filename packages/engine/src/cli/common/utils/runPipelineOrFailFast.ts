import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { type PipelineResult, runImplementPipeline } from '#src/pipeline/index.ts';
import { RunLockError } from '#src/runState/index.ts';

/**
 * Run the pipeline; a RunLockError is a clean fail-fast message (no stack, no
 * run state was created). The parameter object shape is imposed by
 * runImplementPipeline (functions.md's externally-imposed-signature exemption),
 * so it is forwarded verbatim rather than re-declared as a `Params` interface.
 */
export const runPipelineOrFailFast = async (params: Parameters<typeof runImplementPipeline>[0]): Promise<PipelineResult> => {
	try {
		return await runImplementPipeline(params);
	} catch (error) {
		if (error instanceof RunLockError) {
			console.error(`\n${error.message}`);
			return exitCli({ code: 1 });
		}

		throw error;
	}
};
