import { remoteWaitTimings } from '#src/ship/common/constants/remoteWaitTimings.ts';
import { hasNoChecks } from '#src/ship/common/utils/hasNoChecks.ts';
import { sleep } from '#src/ship/common/utils/sleep.ts';
import { type ChecksSummary, readPullRequestChecks } from '#src/ship/forge/index.ts';

interface Params {
	prNumber: number;
	cwd: string;
	/** Resolved once at the edge: whether this repository has explicitly said it has no CI. */
	allowNoCi: boolean;
	/** The exact candidate commit this attempt pushed — the only commit whose checks may count. */
	expectedHead: string;
	/** Live progress sink — one line per poll. Silent when omitted. */
	onProgress?: (message: string) => void;
}

/**
 * Poll the pull request's checks until they settle, or until the wait ceiling
 * is reached.
 *
 * The first poll happens before any sleep, so a pull request whose checks are
 * already green merges without a pause. A poll that cannot be read is retried
 * rather than treated as failure — a transient forge error must not fail a
 * merge — and a run of unreadable polls ends at the same ceiling, carrying
 * `readable: false` so the caller reports a timeout rather than claiming this
 * repository has no CI.
 *
 * An empty check list is never a pass on its own. A repository that has
 * explicitly opted out (`ship.allow-no-ci`) still waits out the registration
 * grace first, because seconds after a pull request is created "no checks" is
 * indistinguishable from "CI has not registered its checks yet". A repository
 * that has not opted out waits to the ceiling and comes back unfinished, which
 * is what lets the caller say `checks-missing` and name the setting.
 */
export const waitForChecks = async ({ prNumber, cwd, allowNoCi, expectedHead, onProgress }: Params): Promise<ChecksSummary> => {
	const { pollIntervalMs, ceilingMs } = remoteWaitTimings;
	const emptyGraceMs = 60_000;
	const startedAt = Date.now();

	let summary: ChecksSummary = { finished: false, green: false, failing: [], pending: [], passing: [], readable: false };
	let readable = false;
	let announcedEmpty = false;
	let waiting = true;

	while (waiting) {
		const polled = await readPullRequestChecks({ prNumber, cwd, expectedHead });

		readable = polled !== undefined;

		if (polled !== undefined) {
			summary = polled;
			onProgress?.(`checks: ${polled.passing.length} passed, ${polled.pending.length} running, ${polled.failing.length} failed`);
		}

		const elapsedMs = Date.now() - startedAt;
		const empty = polled !== undefined && hasNoChecks({ summary: polled });

		if (empty && !allowNoCi && !announcedEmpty) {
			announcedEmpty = true;
			onProgress?.('checks: the forge lists none for this commit — ship requires CI, so it waits for them to register');
		}

		// An empty list settles only for a repository that opted out, and only
		// once the registration grace has passed.
		const held = empty && (!allowNoCi || elapsedMs < emptyGraceMs);

		if (polled?.finished === true && !held) {
			waiting = false;
		} else if (elapsedMs >= ceilingMs) {
			summary = { ...summary, finished: false };
			waiting = false;
		} else {
			await sleep({ ms: pollIntervalMs });
		}
	}

	return { ...summary, readable };
};
