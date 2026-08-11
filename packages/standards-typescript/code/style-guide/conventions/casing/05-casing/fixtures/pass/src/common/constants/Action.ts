// A named constant, which the table puts in PascalCase alongside its type.
export const Action = {
	Add: 'add',
	Remove: 'remove',
} as const;

export type Action = (typeof Action)[keyof typeof Action];
