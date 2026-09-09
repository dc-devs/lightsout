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
	/**
	 * Whether the observation these fields were folded from was read and
	 * validated, rather than guessed at.
	 *
	 * A forge that answered with a login prompt and a forge that answered with an
	 * empty list fold to the same four fields, and the two mean opposite things:
	 * one is "CI has not been read", the other is "this repository has no CI for
	 * this commit". Only the second may ever become a missing-CI verdict.
	 */
	readable: boolean;
}
