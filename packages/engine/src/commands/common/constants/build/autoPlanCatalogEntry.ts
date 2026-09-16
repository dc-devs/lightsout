import { type CommandCatalogEntry, CommandGroup, CommandRecordKind } from '#src/contracts/index.ts';

/**
 * `/auto-plan` — a skill with no CLI command behind it: it runs the same
 * planner `/plan` runs, in automatic mode, and what it changes is who answers
 * the questions.
 *
 * The engine owns the loop either way, so there is no worker loop, repair
 * budget or stage schedule here to differ from the interactive entry.
 */
export const autoPlanCatalogEntry: CommandCatalogEntry = {
	id: 'auto-plan',
	slash: '/auto-plan',
	group: CommandGroup.Build,
	summary:
		'Plan a ticket alone — the engine answers every question below a written escalation bar, stops at the ones that are genuinely yours, and rolls onward per the `auto-plan` config block.',
	whenToUse:
		'Reach for it when the ticket is shaped enough that you would answer most of the interview with "you decide". It is the same planner the interactive entry runs, with the same records, reviews and readiness — only the answering differs: it stops for a question two reasonable engineers would answer differently, and for nothing else. The `auto-plan` config block decides whether a proposal is shown before drafting, and whether approving it starts the build.',
	invocations: [],
	flags: [],
	steps: [],
	records: CommandRecordKind.Plans,
	related: ['brainstorm', 'plan', 'implement', 'resume', 'ship', 'implement-direct', 'queue', 'ticket', 'ticket-state', 'self-check'],
};
