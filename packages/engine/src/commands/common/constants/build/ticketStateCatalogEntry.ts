import { type CommandCatalogEntry, CommandGroup, CommandRecordKind } from '#src/contracts/index.ts';

/** `lightsout ticket-state` — the deterministic tracker write every workflow skill shells out to. */
export const ticketStateCatalogEntry: CommandCatalogEntry = {
	id: 'ticket-state',
	cli: 'lightsout ticket-state',
	group: CommandGroup.Build,
	summary: "Write a ticket's planning status, its tracker workflow status, or both.",
	whenToUse:
		'Run it at a workflow transition — when brainstorming finishes, when a plan is approved, when implementation begins — so the ticket says what preparation it still owes and where implementation stands. The workflow skills call it at each of those moments, so the tracker says the same thing however the work was started.',
	invocations: [{ id: 'ticket-state' }],
	flags: [
		{ name: 'ref', value: '<ticket>', meaning: 'The ticket to write, by its human reference.', required: true },
		{
			name: 'planning-status',
			value: '<status>',
			meaning:
				'What preparation the ticket still owes: planning-needs-brainstorm, planning-needs-plan, planning-ready-auto-plan, planning-complete or planning-not-needed.',
			fallback: 'The planning status is left as it is.',
			required: false,
		},
		{
			name: 'tracker-status',
			value: 'ready|in-progress',
			meaning:
				'Where implementation stands, named by role so one line works in every repository: ready when shaping is finished and implementation is waiting, in-progress when source changes have begun. Done is not among them — a ticket reaches done only when a merge is positively confirmed, which the ship path writes.',
			fallback: 'The tracker status is left as it is.',
			required: false,
		},
		{ name: 'cwd', value: '<path>', meaning: 'Repository whose config names the tracker.', fallback: 'The process working directory.', required: false },
	],
	steps: [],
	records: CommandRecordKind.Nothing,
	related: ['auto-plan', 'brainstorm', 'plan', 'implement', 'implement-direct', 'resume', 'ship', 'queue'],
};
