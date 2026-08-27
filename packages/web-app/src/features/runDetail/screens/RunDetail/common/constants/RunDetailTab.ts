/** The six views a run's evidence is split into, and the value each tab is held by. */
export const RunDetailTab = {
	Overview: 'overview',
	Steps: 'steps',
	Gates: 'gates',
	Agents: 'agents',
	Files: 'files',
	Friction: 'friction',
} as const;

export type RunDetailTab = (typeof RunDetailTab)[keyof typeof RunDetailTab];
