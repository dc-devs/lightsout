/** Where a pull request's checks stand at one moment, folded from whatever rows the forge reported. */
export interface ChecksSummary {
	/** True when every required check has finished. */
	finished: boolean;
	/** True when every finished check passed. Meaningless while `finished` is false. */
	green: boolean;
	/** Names of checks that finished red. */
	failing: string[];
	/** Names of checks still running. */
	pending: string[];
	/**
	 * Names of checks that finished green (a skipped check counts as one).
	 *
	 * Carried so a caller can tell "the forge lists no checks at all" from "every
	 * check the forge lists has passed" — the two fold to the same `finished`,
	 * `green`, `failing` and `pending`, and `waitForChecks` has to treat them
	 * differently or it would merge a pull request whose CI has not registered
	 * yet.
	 */
	passing: string[];
}
