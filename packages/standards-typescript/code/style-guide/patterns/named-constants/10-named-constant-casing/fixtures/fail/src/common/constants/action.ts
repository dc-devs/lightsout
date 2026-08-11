// Members consumers dot into, so it is a named constant — and named constants
// are PascalCase, file included.
export const action = {
	Add: 'add',
	Remove: 'remove',
} as const;

export type action = (typeof action)[keyof typeof action];
