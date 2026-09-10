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
		{
			name: 'worktree',
			meaning: 'Build in a fresh git worktree of this repository, on a branch named after the ticket.',
			fallback: 'The `implement.worktree` config key, which defaults to on.',
			required: false,
		},
		{ name: 'no-worktree', meaning: 'Build in the checkout this was launched from rather than a worktree of its own.', required: false },
		{ name: 'ship', meaning: 'Ship the branch after the run passes: open or adopt the PR, wait for checks, merge, clean up.', required: false },
		{ name: 'no-ship', meaning: 'End on the run result even when the config’s `ship.after-implement` asks to chain into ship.', required: false },
	],
	steps: [],
	records: CommandRecordKind.Runs,
	related: ['auto-plan', 'brainstorm', 'plan', 'implement', 'queue', 'resume', 'ship', 'ticket-state', 'self-check'],
};
