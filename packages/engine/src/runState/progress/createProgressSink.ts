import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createEventFileSink } from '#src/common/utils/createEventFileSink.ts';
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
 * The run's folder is looked up inside the promise the sink already took,
 * rather than awaited here: `RunState` builds this in its constructor, and a
 * constructor cannot await. `ready` derives from the same promise, so a lookup
 * that fails is handled whether or not the run ever narrates a line.
 *
 * @returns A synchronous call that never throws — persisting narration must
 * never fail a run.
 */
export const createProgressSink = ({ cwd, runId }: Params): ((message: string) => void) => {
	const logPath = getProgressLogPath({ cwd, runId });
	const sink = createEventFileSink({ path: logPath, ready: logPath.then((path) => mkdir(dirname(path), { recursive: true })) });

	return (message) => {
		sink({ at: new Date().toISOString(), message });
	};
};
