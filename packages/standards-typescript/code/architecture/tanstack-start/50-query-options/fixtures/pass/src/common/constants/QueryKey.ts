export const QueryKey = {
	Issues: 'issues',
} as const;

export type QueryKey = (typeof QueryKey)[keyof typeof QueryKey];
