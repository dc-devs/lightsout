import { type CommandCatalogEntry, CommandGroup, CommandRecordKind } from '#src/contracts/index.ts';

/** `lightsout report` — reads the activity record the plan commands already wrote, so it spawns nothing and records nothing. */
export const reportCatalogEntry: CommandCatalogEntry = {
	id: 'report',
	cli: 'lightsout report',
	group: CommandGroup.Housekeeping,
	summary: "Show where a plan's hours and money went: every level of the run down to each harness process, with its time, tokens and cost.",
	whenToUse:
		'Reach for it after planning a ticket, when you want to know which step burned the hours, how many harness processes it took and what it cost. It reads what the plan commands recorded, so it spends nothing and can be run as often as you like. Name a ticket folder rather than one plan to see what the whole ticket cost.',
	invocations: [{ id: 'report' }],
	flags: [
		{
			name: 'plan',
			value: '<name>',
			meaning:
				'The plan to report on — a plan address, a legacy plan folder name, or a ticket folder, which reports every plan under it beneath one totalled ticket row.',
			required: true,
		},
		{
			name: 'json',
			meaning: 'Print the same totalled tree as data instead of the table, so a chart and this table read one calculation.',
			fallback: 'The table is printed.',
			required: false,
		},
		{ name: 'cwd', value: '<path>', meaning: 'Repository whose plan folders are read.', fallback: 'The process working directory.', required: false },
	],
	steps: [],
	records: CommandRecordKind.Nothing,
	related: ['status', 'doctor', 'friction', 'improve', 'voice'],
};
