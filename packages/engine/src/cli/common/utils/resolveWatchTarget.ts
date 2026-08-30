import { setTimeout as delay } from 'node:timers/promises';
import { RunStatus } from '#src/contracts/index.ts';
import { listRuns } from '#src/views/index.ts';

/** The most recently updated run that has not finished, or undefined when none has started. */
const findGoingRun = async ({ cwd }: { cwd: string }) =>
	(await listRuns({ cwd })).find((run) => run.status === RunStatus.Running || run.status === RunStatus.Pending);

interface Params {
	cwd: string;
	/** How long to wait for a run to start before giving up. */
	graceMs?: number;
	/** How often to look while waiting. */
	pollMs?: number;
}

/**
 * The run a `--watch` with no `--run` should follow: the most recently updated
 * one that is still going.
 *
 * The wait exists because of a race the implement skill would otherwise lose.
 * The skill starts the run in the background and the watch immediately after,
 * and a run that has not yet written its first manifest is invisible — so a
 * watch that simply took the newest run would attach to the PREVIOUS run and
 * narrate the wrong work. Waiting for a going run closes that window.
 *
 * @returns The run id to follow, or undefined when the grace period passed
 * with nothing going — the caller falls back to the newest run of any status,
 * so a terminal user in a quiet repo still gets one frame.
 */
export const resolveWatchTarget = async ({ cwd, graceMs = 60_000, pollMs = 2_000 }: Params): Promise<string | undefined> => {
	const deadline = Date.now() + graceMs;
	let going = await findGoingRun({ cwd });

	while (going === undefined && Date.now() < deadline) {
		await delay(pollMs);
		going = await findGoingRun({ cwd });
	}

	return going?.runId;
};
