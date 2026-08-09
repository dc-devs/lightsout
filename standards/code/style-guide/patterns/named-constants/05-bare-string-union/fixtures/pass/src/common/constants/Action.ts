export const Action = {
	Add: 'add',
	Remove: 'remove',
	List: 'list',
	Update: 'update',
} as const;

export type Action = (typeof Action)[keyof typeof Action];
