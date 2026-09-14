/**
 * The size in bytes at or below which a source file is supplied to a plan writer
 * whole, with no extraction at all.
 *
 * Roughly 300 lines, which sits just above this repository's own 250-line file
 * cap — so an ordinary source file is never reduced, and only a genuinely
 * oversized consumer file is. Stated once because two consumers read it: the
 * collector decides with it, and the brief renderer states it when telling a
 * writer why a file arrived reduced.
 */
export const wholeFileEvidenceLimit = 12000;
