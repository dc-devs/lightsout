import { type CommandCatalogEntry, CommandGroup, CommandRecordKind } from '#src/contracts/index.ts';

/** `/auto-plan` — a skill with no CLI command behind it: it drives the `plan` subcommands, and what it changes is who answers the questions. */
export const autoPlanCatalogEntry: CommandCatalogEntry = {
	id: 'auto-plan',
	slash: '/auto-plan',
	group: CommandGroup.Build,
	summary:
		'Plan a ticket alone — self-answers every question below a written escalation bar, shows you one proposal, and rolls onward per the `auto-plan` config block.',
	whenToUse:
		'Reach for it when the ticket is shaped enough that you would answer most of the interview with "you decide". It stops for the questions two reasonable engineers would answer differently, and for nothing else; the `auto-plan` config block says whether approval also starts the build.',
	invocations: [],
	flags: [],
	steps: [],
	records: CommandRecordKind.Plans,
	related: ['brainstorm', 'plan', 'implement', 'resume', 'ship', 'implement-direct', 'queue', 'ticket-state'],
};
