/**
 * Whether a parsed value is a plain object whose keys can be read.
 *
 * Positional by necessity, and the one place in this package that is: a type
 * predicate narrows the argument it is handed by POSITION, so wrapping the
 * value in an object — as every other function here does — would compile and
 * narrow nothing, leaving the caller to reach for the `as` cast this exists to
 * avoid. The document's own carve-out covers it: the shape is dictated by the
 * language, not chosen here.
 *
 * Arrays are excluded deliberately. `typeof value === 'object'` lets them
 * through, and a caller reading named fields off one gets undefined for every
 * key rather than an error.
 */
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
