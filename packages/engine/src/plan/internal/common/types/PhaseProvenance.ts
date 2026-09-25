/**
 * Where every path in a phased plan comes from and goes to, resolved by walking
 * the phases in order. `providedBefore` and `removedBefore` are keyed by a
 * phase's basename and hold what STRICTLY EARLIER phases did, so a phase is
 * never treated as its own predecessor.
 *
 * Both sets are NET, not cumulative: each is the state after the last operation
 * on that path, not a history of every operation. Supplying a path (create, or
 * move to) removes it from `removedBefore`; removing one (delete, or move away)
 * removes it from `providedBefore`. A file deleted by phase 2, recreated by
 * phase 3 and modified by phase 4 is therefore legal — cumulative sets would
 * have phase 4's modify collide with phase 2's delete and report a blocking
 * finding against work that is perfectly ordered.
 */
export interface PhaseProvenance {
	/** Phase basename → every path an earlier phase creates or moves to. */
	providedBefore: Map<string, Set<string>>;
	/** Phase basename → every path an earlier phase deletes or moves away from. */
	removedBefore: Map<string, Set<string>>;
	/** Path → the basename of the phase that most recently creates it or moves to it. */
	createdBy: Map<string, string>;
	/** Path → the basename of the phase that most recently deletes it or moves it away. */
	removedBy: Map<string, string>;
}
