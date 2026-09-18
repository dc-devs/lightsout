/**
 * The three kinds of line an activity record holds.
 *
 * A closed set rather than free text, because it is the discriminant every
 * reader narrows on: a line whose kind nothing recognises is a line the fold
 * has to drop rather than guess at.
 */
export const ActivityMarkKind = {
	/** A level opened — its identity, its parent and what it is. */
	LevelStart: 'level-start',
	/** A level closed, and how it settled. */
	LevelEnd: 'level-end',
	/** One harness process, start to finish, with what it reported spending. */
	HarnessProcess: 'harness-process',
} as const;

export type ActivityMarkKind = (typeof ActivityMarkKind)[keyof typeof ActivityMarkKind];
