import { type CommandCatalogEntry, CommandGroup, CommandRecordKind } from '#src/contracts/index.ts';

/** `lightsout status` — what lightsout sees here, either across every run or inside one of them. */
export const statusCatalogEntry: CommandCatalogEntry = {
	id: 'status',
	cli: 'lightsout status',
	group: CommandGroup.Housekeeping,
	summary: 'Show what lightsout sees in this repo: config, harness, packs, any run still parked — and, for one run, what it is doing right now.',
	whenToUse:
		'Run it when you come back to a repo and need to know what lightsout thinks is going on. It names the config, the harness, the packs in play, and any run still parked. Name a run and it shows what is happening inside that run instead: its steps, their outcomes and durations, and what it is working on this moment.',
	invocations: [{ id: 'status' }, { id: 'status-run', note: 'one run in detail; --watch repaints it every two minutes' }],
	flags: [
		{
			name: 'run',
			value: '<id>',
			meaning: 'Show one run in detail — its steps, their outcomes and durations, what it is doing now. Takes the shortened eight-character id reports print.',
			fallback: 'Every run is listed, one line each.',
			shape: 'status-run',
			required: false,
		},
		{
			name: 'watch',
			meaning: 'Repaint the detail block every two minutes until the run stops, so a detached run can be followed.',
			fallback: 'The block is printed once.',
			shape: 'status-run',
			required: false,
		},
		{ name: 'cwd', value: '<path>', meaning: 'Repository to report on.', fallback: 'The process working directory.', required: false },
	],
	steps: [],
	records: CommandRecordKind.Nothing,
	related: ['doctor', 'friction', 'improve', 'voice'],
};
