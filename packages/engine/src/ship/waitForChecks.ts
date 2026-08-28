import { type ChecksSummary, readPullRequestChecks } from '#src/ship/forge/index.ts';

interface Params {
	prNumber: number;
	cwd: string;
	/** Live progress sink — one line per poll. Silent when omitted. */
	onProgress?: (message: string) => void;
}

/** Whether the forge is listing no checks at all — which is not the same answer as "every check passed". */
const isEmpty = ({ summary }: { summary: ChecksSummary }) => summary.failing.length === 0 && summary.pending.length === 0 && summary.passing.length === 0;

const sleep = ({ ms }: { ms: number }) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Poll the pull request's checks until they settle, or until the wait ceiling
 * is reached.
 *
 * The first poll happens before any sleep, so a pull request whose checks are
 * already green merges without a pause. A poll that cannot be read is retried
 * rather than treated as failure — a transient forge error must not fail a
 * merge — and a run of unreadable polls simply ends at the same ceiling, which
 * is what lets a timed-out result still name what it was waiting on.
 *
 * An empty check list gets a grace window before it counts as "no CI". Seconds
 * after a pull request is created, "no checks" is indistinguishable from "CI
 * has not registered its checks yet", and folding it straight to green would
 * merge before the repo's own gates ever ran. A repo with no CI ships after one
 * minute; a repo whose CI is merely slow to register is caught by the first
 * poll that shows a pending check. The window applies uniformly, and an adopted
 * pull request with checks already on it is unaffected — its list is not empty.
 */
export const waitForChecks = async ({ prNumber, cwd, onProgress }: Params): Promise<ChecksSummary> => {
	const pollIntervalMs = 30_000;
	const ceilingMs = 30 * 60_000;
	const emptyGraceMs = 60_000;
	const startedAt = Date.now();

	let summary: ChecksSummary = { finished: false, green: false, failing: [], pending: [], passing: [] };
	let waiting = true;

	while (waiting) {
		const polled = await readPullRequestChecks({ prNumber, cwd });

		if (polled !== undefined) {
			summary = polled;
			onProgress?.(`checks: ${polled.passing.length} passed, ${polled.pending.length} running, ${polled.failing.length} failed`);
		}

		const elapsedMs = Date.now() - startedAt;
		const graced = polled !== undefined && isEmpty({ summary: polled }) && elapsedMs < emptyGraceMs;

		if (polled?.finished === true && !graced) {
			waiting = false;
		} else if (elapsedMs >= ceilingMs) {
			summary = { ...summary, finished: false };
			waiting = false;
		} else {
			await sleep({ ms: pollIntervalMs });
		}
	}

	return summary;
};
