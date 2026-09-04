export interface GateRunResult {
	error: string | undefined;
	/**
	 * Gate kinds that went red on evidence about the code — what a fix agent
	 * is asked to repair. A gate that only crashed is deliberately absent: its
	 * red is a toolchain fault, and handing it over would spend a repair on a
	 * suite that is not broken.
	 */
	failedFamilies: string[];
	/**
	 * One operator-readable line per gate the engine could not get a verdict
	 * out of, because every attempt died in the known jest worker crash. Empty
	 * on every ordinary run, including one where a crash was absorbed by a
	 * re-run. A non-empty list always comes with an `error`, so a caller that
	 * reads nothing but `error` still fails closed.
	 */
	crashes: string[];
}
