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
	/**
	 * Why this gate run never started — the machine was held by another gate run
	 * of the same repository, or the shared reservation could not be written at
	 * all. Set together with `error` and with `failedFamilies: []`, exactly as
	 * `crashes` is, so a caller reading only `error` still fails closed while a
	 * caller that would spend a repair has one member to check rather than a
	 * message to parse.
	 *
	 * Not evidence about the code: no gate command executed, so no fix agent may
	 * be spent on it and no supervisor bought. Declared required-but-possibly-
	 * undefined rather than optional, so the compiler finds every literal that
	 * builds one of these instead of letting a caller silently inherit a missing
	 * member.
	 */
	coordination: string | undefined;
}
