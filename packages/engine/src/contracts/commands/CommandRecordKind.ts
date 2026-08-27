/** What a command leaves behind — the tag on its card and the shape of its history section. */
export const CommandRecordKind = {
	Runs: 'runs',
	Plans: 'plans',
	Snapshots: 'snapshots',
	Nothing: 'nothing',
} as const;

export type CommandRecordKind = (typeof CommandRecordKind)[keyof typeof CommandRecordKind];
