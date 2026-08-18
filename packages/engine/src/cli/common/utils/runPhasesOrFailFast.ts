import { exitCli } from '@/cli/common/utils/exitCli';
import { messageOf } from '@/common/utils/messageOf';
import { runPhasesPipeline } from '@/phases';
import type { PipelineResult } from '@/pipeline';
import { RunLockError } from '@/runState';

/**
 * Run a phased sequence; every throw on the way in is a clean one-line exit.
 *
 * The coordinator's own initialization throws (a missing phase file, an
 * unfinished sequence for this overview), and a phase can collide with a live
 * repo lock — neither is worth a stack trace, and both leave the sequence
 * exactly resumable. The parameter object shape is imposed by runPhasesPipeline
 * (functions.md's externally-imposed-signature exemption), so it is forwarded
 * verbatim rather than re-declared as a `Params` interface.
 */
export const runPhasesOrFailFast = async (params: Parameters<typeof runPhasesPipeline>[0]): Promise<PipelineResult> => {
	try {
		return await runPhasesPipeline(params);
	} catch (error) {
		console.error(`\n${error instanceof RunLockError ? error.message : messageOf({ error })}`);
		return exitCli({ code: 1 });
	}
};
