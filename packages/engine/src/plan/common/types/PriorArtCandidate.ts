/**
 * A planned new symbol whose name-key collides with one or more existing
 * exports — a prior-art candidate for the judge to rule on. A local shape, not
 * a persisted contract: it is the deterministic detection half, merged with the
 * agent's verdict into a `DedupFinding` downstream.
 */
export interface PriorArtCandidate {
	plannedSymbol: string;
	/** Repo-relative Files-to-Create path the symbol would be created at. */
	plannedPath: string;
	collidesWith: Array<{ name: string; path: string }>;
}
