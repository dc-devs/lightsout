/**
 * The two size numbers the lint derives for one plan file: how many source
 * files it creates, and how many it touches in any way. The pair travels from
 * the per-file loop that counts it to every check that measures against it, so
 * it is one declaration rather than a shape re-typed at each seam.
 */
export interface PhaseSizeCounts {
	created: number;
	touched: number;
}
