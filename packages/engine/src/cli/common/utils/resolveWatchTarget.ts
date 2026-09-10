import { setTimeout as delay } from 'node:timers/promises';
import type { WatchTarget } from '#src/cli/common/types/WatchTarget.ts';
import { type RunListing, RunStatus } from '#src/contracts/index.ts';
import { listRuns } from '#src/views/index.ts';

/** The going runs sharing one root — a coordinator and the phase children it started are one family, and one choice. */
interface RunFamily {
	root: string;
	runs: RunListing[];
}

/** The run family a listing belongs to: its coordinator when it records one, itself otherwise. */
const rootOf = ({ run }: { run: RunListing }) => run.parentRunId ?? run.runId;

/** Every run that has not finished, newest first — the order `listRuns` already answers in. */
const findGoingRuns = async ({ cwd, rootRunId }: { cwd: string; rootRunId?: string }) =>
	(await listRuns({ cwd })).filter(
		(run) => (run.status === RunStatus.Running || run.status === RunStatus.Pending) && (rootRunId === undefined || rootOf({ run }) === rootRunId),
	);

/**
 * The going runs grouped into families, keyed by root.
 *
 * A phased plan has two live manifests at once — the coordinator and the phase
 * child it started — and counting those as two active runs would call every
 * phased run ambiguous and refuse to watch any of them. They share a root, so
 * they are one family and one choice.
 */
const groupFamilies = ({ going }: { going: RunListing[] }): RunFamily[] => {
	const families = new Map<string, RunListing[]>();

	for (const run of going) {
		const root = rootOf({ run });

		families.set(root, [...(families.get(root) ?? []), run]);
	}

	return [...families].map(([root, runs]) => ({ root, runs }));
};

/**
 * The families this choice is between: the ones with a live process behind
 * them, or every going family when none has one.
 *
 * Going by status alone is not enough. A `running` manifest with nothing behind
 * it is an ordinary state here — the status listing already prints `no live
 * process — crashed?` for one — so a single crash leftover beside a freshly
 * started run would make every bare `--watch` ambiguous, which is exactly the
 * call the implement skill makes right after starting a run.
 *
 * Liveness alone is no better: a phased coordinator holds no lock of its own
 * between phases, so in that gap the whole family would read as dead and drop
 * out. The fallback is the same tolerance `watchRunProgress` shows by ending a
 * watch only after two consecutive dead frames.
 */
const selectCandidates = ({ families }: { families: RunFamily[] }) => {
	const live = families.filter((family) => family.runs.some((run) => run.live));

	return live.length > 0 ? live : families;
};

interface Params {
	cwd: string;
	/** Follow only this run and the phase children it started. Omitted on the one call made before any run has been chosen. */
	rootRunId?: string;
	/** How long to wait for a run to start before giving up. */
	graceMs?: number;
	/** How often to look while waiting. */
	pollMs?: number;
}

/**
 * The run a `--watch` should follow: the one that is going, or the ids of the
 * several that are.
 *
 * The wait exists because of a race the implement skill would otherwise lose.
 * The skill starts the run in the background and the watch immediately after,
 * and a run that has not yet written its first manifest is invisible — so a
 * watch that simply took the newest run would attach to the PREVIOUS run and
 * narrate the wrong work. Waiting for a going run closes that window.
 *
 * Once something is going, the choice is between run FAMILIES rather than runs,
 * and it is never guessed: two unrelated families going at once are named back
 * to the reader so they can pick one with `--run <id>`. Inside the chosen
 * family the most recently updated run is the one painted, which during a phase
 * is the child and between phases is the coordinator.
 *
 * @returns the run to paint and the family it belongs to, the root ids of the
 * families that are ambiguous, or undefined when the grace period passed with
 * nothing going — the caller falls back to the newest run of any status, so a
 * terminal user in a quiet repo still gets one frame.
 */
export const resolveWatchTarget = async ({ cwd, rootRunId, graceMs = 60_000, pollMs = 2_000 }: Params): Promise<WatchTarget | undefined> => {
	const deadline = Date.now() + graceMs;
	let going = await findGoingRuns({ cwd, rootRunId });

	while (going.length === 0 && Date.now() < deadline) {
		await delay(pollMs);
		going = await findGoingRuns({ cwd, rootRunId });
	}

	const candidates = selectCandidates({ families: groupFamilies({ going }) });
	const [only] = candidates;
	// `listRuns` answers newest first, so a family's head is the run moving right
	// now: the phase child during a phase, the coordinator in the gap between two.
	const head = only?.runs[0];
	let target: WatchTarget | undefined;

	if (candidates.length > 1) {
		target = { ambiguous: candidates.map((family) => family.root) };
	} else if (only !== undefined && head !== undefined) {
		target = { runId: head.runId, rootRunId: only.root };
	}

	return target;
};
