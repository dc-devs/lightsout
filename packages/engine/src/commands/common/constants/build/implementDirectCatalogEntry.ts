import { type CommandCatalogEntry, CommandGroup, CommandRecordKind } from '#src/contracts/index.ts';

/** `lightsout implement-direct` — the plan-less half of implement, and the worker the queue's direct route runs. */
export const implementDirectCatalogEntry: CommandCatalogEntry = {
	id: 'implement-direct',
	cli: 'lightsout implement-direct',
	group: CommandGroup.Build,
	summary: "Build one ticket straight from its body, with the repo's own gates as the only bar, and commit what passes.",
	whenToUse:
		'Run it on work small enough that a plan would cost more than the work: it reads the ticket body, builds from it, runs the repo’s gates, and commits. It refuses a dirty tree, because it commits everything in the tree when it is done.',
	invocations: [{ id: 'implement-direct' }],
	flags: [
		{ name: 'ticket', value: '<path>', meaning: 'A file holding the ticket body to build from.', required: true },
		{
			name: 'ref',
			value: '<ticket>',
			meaning: 'The ticket reference the run and its commit are labelled with.',
			fallback: 'The ticket reference the current branch carries.',
			required: false,
		},
		{ name: 'cwd', value: '<path>', meaning: 'Repository to build in.', fallback: 'The process working directory.', required: false },
		{ name: 'ship', meaning: 'Ship the branch after the run passes: open or adopt the PR, wait for checks, merge, clean up.', required: false },
	],
	steps: [],
	records: CommandRecordKind.Runs,
	related: ['auto-plan', 'brainstorm', 'plan', 'implement', 'queue', 'resume', 'ship'],
};
