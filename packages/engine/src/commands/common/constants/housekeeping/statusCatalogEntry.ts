import { type CommandCatalogEntry, CommandGroup, CommandRecordKind } from '#src/contracts/index.ts';

/** `lightsout status` — what lightsout sees here, and nothing it can be narrowed to. */
export const statusCatalogEntry: CommandCatalogEntry = {
	id: 'status',
	cli: 'lightsout status',
	group: CommandGroup.Housekeeping,
	summary: 'Show what lightsout sees in this repo: config, harness, packs, and any run still parked.',
	whenToUse:
		'Run it when you come back to a repo and need to know what lightsout thinks is going on. It names the config, the harness, the packs in play, and any run still parked.',
	invocations: [{ id: 'status' }],
	flags: [{ name: 'cwd', value: '<path>', meaning: 'Repository to report on.', fallback: 'The process working directory.', required: false }],
	steps: [],
	records: CommandRecordKind.Nothing,
	related: ['doctor', 'friction', 'improve', 'voice'],
};
