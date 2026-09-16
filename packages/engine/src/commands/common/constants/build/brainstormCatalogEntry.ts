import { type CommandCatalogEntry, CommandGroup, CommandRecordKind } from '#src/contracts/index.ts';

/**
 * `/brainstorm` — a skill with one subcommand behind it, `publish`; `auto-plan`
 * is the remaining skill-only entry.
 *
 * What it owns is the product: what gets built, what it is worth, what is
 * explicitly out. It settles that with you and says which technical questions
 * it is delegating, so the planner never reopens a product decision you already
 * made.
 */
export const brainstormCatalogEntry: CommandCatalogEntry = {
	id: 'brainstorm',
	slash: '/brainstorm',
	cli: 'lightsout brainstorm',
	group: CommandGroup.Build,
	summary:
		'Shape a vague idea into a buildable direction through dialogue — explores the branches, offers competing approaches with trade-offs and a recommendation, and converges on a design stated in plain words.',
	whenToUse:
		'Reach for it when the idea is still a sentence and you are not sure it is one idea or three. It pressure-tests the product direction against an independent reader, records your own wording and the decisions you confirmed, and says in writing which technical questions it is handing to planning — so planning inherits that alignment instead of interviewing you again.',
	invocations: [{ id: 'brainstorm-publish', positional: 'publish' }],
	flags: [
		{
			name: 'name',
			value: '<name>',
			meaning: 'The brainstorm’s plan, under .lightsout/plans/ — a plan address <ticket-branch>/<NNN-slug>, or a legacy folder name.',
			required: true,
		},
		{ name: 'cwd', value: '<path>', meaning: 'Repository the brainstorm workspace lives in.', fallback: 'The process working directory.', required: false },
	],
	steps: [],
	records: CommandRecordKind.Plans,
	related: ['auto-plan', 'plan', 'implement', 'resume', 'ship', 'implement-direct', 'queue', 'ticket', 'ticket-state', 'self-check'],
};
