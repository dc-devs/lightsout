/** What a barrel makes public, and whether this run managed to read all of it. */
export interface BarrelSurface {
	/** Repo-relative files the barrel re-exports, as far as they could be resolved. */
	targets: Set<string>;
	/**
	 * False when a re-export could not be resolved. The target set is then a
	 * floor rather than the whole surface, so a rule may still say "this file IS
	 * exported" but must never conclude "this file is NOT exported".
	 */
	complete: boolean;
}
