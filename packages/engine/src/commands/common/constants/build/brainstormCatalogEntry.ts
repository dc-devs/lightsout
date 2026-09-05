import { type CommandCatalogEntry, CommandGroup, CommandRecordKind } from '#src/contracts/index.ts';

/** `/brainstorm` — a skill with one subcommand behind it, `publish`; `auto-plan` is the remaining skill-only entry. */
export const brainstormCatalogEntry: CommandCatalogEntry = {
	id: 'brainstorm',
	slash: '/brainstorm',
	cli: 'lightsout brainstorm',
	group: CommandGroup.Build,
	summary:
		'Shape a vague idea into a buildable direction through dialogue — checks whether it is one idea or several, offers 2–3 competing approaches with trade-offs and a recommendation, and converges on a design stated in plain words.',
	whenToUse:
		'Reach for it when the idea is still a sentence and you are not sure it is one idea or three. It decides its own outcome — ready to implement, or ready to auto-plan — and publishes the design write-up and the settled decisions to the ticket.',
	invocations: [{ id: 'brainstorm-publish', positional: 'publish' }],
	flags: [
		{ name: 'name', value: '<name>', meaning: 'The brainstorm workspace to publish, under .lightsout/plans/.', required: true },
		{ name: 'cwd', value: '<path>', meaning: 'Repository the brainstorm workspace lives in.', fallback: 'The process working directory.', required: false },
	],
	steps: [],
	records: CommandRecordKind.Plans,
	related: ['auto-plan', 'plan', 'implement', 'resume', 'ship', 'implement-direct', 'queue', 'ticket-state'],
};
