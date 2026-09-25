export const FrictionKind = {
	/** Something fought or confused the agent. */
	Friction: 'friction',
	/** The input was silent and the agent had to choose between reasonable options. */
	Decision: 'decision',
} as const;

export type FrictionKind = (typeof FrictionKind)[keyof typeof FrictionKind];
