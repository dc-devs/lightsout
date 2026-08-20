/** The first segment of every query key in this app, so no call site retypes a raw string. */
export const QueryKey = {
	Runs: 'runs',
	Run: 'run',
	Standards: 'standards',
	Plan: 'plan',
	RepoRoot: 'repoRoot',
} as const;

export type QueryKey = (typeof QueryKey)[keyof typeof QueryKey];
