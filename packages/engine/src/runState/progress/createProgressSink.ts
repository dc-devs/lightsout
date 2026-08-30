import { mkdir } from 'node:fs/promises';
import { createEventFileSink } from '#src/common/utils/createEventFileSink.ts';
import { getRunDir } from '#src/runState/common/paths/getRunDir.ts';
import { getProgressLogPath } from '#src/runState/progress/getProgressLogPath.ts';

interface Params {
	cwd: string;
	runId: string;
}

/**
 * A sink that persists every line a run narrates to its own progress log.
 *
 * A detached run leaves no stdout to tail, so the terminal that started it is
 * the only place its narration ever existed — and that terminal dies. Every
 * narrator tees through this: the run state each pipeline holds, and the
 * phases coordinator, which holds none. Sharing the sink is what keeps the
 * on-disk line one shape rather than one shape per narrator.
 *
 * @returns A synchronous call that never throws — persisting narration must
 * never fail a run.
 */
export const createProgressSink = ({ cwd, runId }: Params): ((message: string) => void) => {
	const sink = createEventFileSink({
		path: getProgressLogPath({ cwd, runId }),
		ready: mkdir(getRunDir({ cwd, runId }), { recursive: true }),
	});

	return (message) => {
		sink({ at: new Date().toISOString(), message });
	};
};
