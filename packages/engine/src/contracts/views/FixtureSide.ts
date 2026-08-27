/**
 * Which side of a rule's proof a fixture file sits on: the shape the rule wants
 * to see, or the one it exists to catch.
 *
 * Both sides are real source trees rather than single files, so the side is
 * what tells a reader which of two folders a path was read from.
 */
export const FixtureSide = {
	Pass: 'pass',
	Fail: 'fail',
} as const;

export type FixtureSide = (typeof FixtureSide)[keyof typeof FixtureSide];
