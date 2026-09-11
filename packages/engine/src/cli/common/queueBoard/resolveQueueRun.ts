import { setTimeout as delay } from 'node:timers/promises';
import { PipelineKind, type RunListing } from '#src/contracts/index.ts';
import { isPidAlive, readRunLock } from '#src/runState/index.ts';
import { listRuns } from '#src/views/index.ts';

/** The queue run the checkout's run lock names, while the lock's process is alive. */
const findLockedQueueRun = async ({ cwd }: { cwd: string }) => {
	const lock = await readRunLock({ cwd });
	const holder = lock !== undefined && isPidAlive({ pid: lock.pid }) ? lock.runId : undefined;

	return holder === undefined ? undefined : (await listRuns({ cwd })).find((run) => run.runId === holder && run.pipeline === PipelineKind.Queue);
};

/** The named run's list row, whatever its pipeline — judging that is the caller's business. */
const findNamedRun = async ({ cwd, runId }: { cwd: string; runId: string }) => (await listRuns({ cwd })).find((run) => run.runId === runId);

interface Params {
	/** The main checkout the queue runs in. */
	cwd: string;
	/** A run id already resolved on disk. */
	runId?: string;
	/** How long to wait for a queue run to take the lock before giving up. */
	graceMs?: number;
	/** How often to look while waiting. */
	pollMs?: number;
}

/**
 * The queue run `status --queue` reports on.
 *
 * Named, it is that run's row, answered at once — it is on disk already, so
 * there is nothing to wait for. Unnamed, it is only the queue run the main
 * checkout's run lock names while the lock's process is alive, waited for
 * within the grace period: the queue skill asks right after launching the
 * queue, before the queue has taken the lock. It never falls back to the
 * newest queue run, which would show a previous invocation's board.
 *
 * @returns the run's list row, or undefined when no queue run is going, or the
 * named run's manifest does not read
 */
export const resolveQueueRun = async ({ cwd, runId, graceMs = 60_000, pollMs = 2_000 }: Params): Promise<RunListing | undefined> => {
	const find = () => (runId === undefined ? findLockedQueueRun({ cwd }) : findNamedRun({ cwd, runId }));
	const deadline = Date.now() + (runId === undefined ? graceMs : 0);
	let listing = await find();

	while (listing === undefined && Date.now() < deadline) {
		await delay(pollMs);
		listing = await find();
	}

	return listing;
};
