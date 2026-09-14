/**
 * One planned symbol that a real existing export answers to.
 *
 * A distinct type from `PriorArtCandidate` rather than a reuse of it, because
 * the two are computed from different inputs: a candidate comes from a written
 * plan file and carries the planned path and the phase file that declared it,
 * while a collision is computed from a phase declaration's `exports` list before
 * any file is written, where neither exists.
 */
export interface ExportCollision {
	/** The symbol name a phase declaration says the writer will export. */
	symbol: string;
	/** Existing exports whose name key matches it. Never empty — a symbol with no match yields no collision. */
	collidesWith: Array<{ name: string; path: string }>;
}
