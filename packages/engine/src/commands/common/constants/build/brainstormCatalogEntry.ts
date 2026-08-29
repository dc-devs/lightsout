import { type CommandCatalogEntry, CommandGroup, CommandRecordKind } from '#src/contracts/index.ts';

/** `/brainstorm` — one of the two skills with no CLI command behind them, which is why it carries no `cli` and no invocations. */
export const brainstormCatalogEntry: CommandCatalogEntry = {
	id: 'brainstorm',
	slash: '/brainstorm',
	group: CommandGroup.Build,
	summary:
		'Shape a vague idea into a buildable direction through dialogue — checks whether it is one idea or several, offers 2–3 competing approaches with trade-offs and a recommendation, and converges on a design stated in plain words.',
	whenToUse:
		'Reach for it when the idea is still a sentence and you are not sure it is one idea or three. It ends either with "just build it" or with a notes file that `/plan` can consume.',
	invocations: [],
	flags: [],
	steps: [],
	records: CommandRecordKind.Plans,
	related: ['auto-plan', 'plan', 'implement', 'resume', 'ship', 'implement-direct', 'queue'],
};
