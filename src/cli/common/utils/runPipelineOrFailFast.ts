import { runImplementPipeline, type PipelineResult } from '@/pipeline';
import { RunLockError } from '@/runState';

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
			process.exit(1);
		}

		throw error;
	}
};
