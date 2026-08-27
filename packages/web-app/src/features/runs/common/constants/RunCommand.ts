/** What a run's `pipeline` means to a reader — the one place the mapping lives. */
export const RunCommand = {
	Implement: 'implement',
	ImplementPhased: 'implement · phased',
	Refactor: 'refactor',
	Coverage: 'coverage',
} as const;

export type RunCommand = (typeof RunCommand)[keyof typeof RunCommand];
