import { type CommandCatalogEntry, CommandGroup, CommandRecordKind } from '#src/contracts/index.ts';

/** `lightsout queue` — no skill ships for it; it is the one command a human starts and then only answers questions for. */
export const queueCatalogEntry: CommandCatalogEntry = {
	id: 'queue',
	cli: 'lightsout queue',
	group: CommandGroup.Build,
	summary: 'Drain the tracker of automatable tickets in parallel worktrees, relaying any question to this terminal.',
	whenToUse:
		'Run it when the tracker holds tickets you have labelled for automation and you want them built without picking them up one at a time: it makes a worktree and branch per ticket, runs the worker its label names, puts any question it cannot answer to this terminal, then ships the ready branches one at a time — each rebased onto fresh main with the gates re-run. It stops when nothing is left to do; running it again resumes whatever parked.',
	invocations: [{ id: 'queue' }],
	flags: [{ name: 'cwd', value: '<path>', meaning: 'Repository to drain into.', fallback: 'The process working directory.', required: false }],
	steps: [],
	records: CommandRecordKind.Runs,
	related: ['auto-plan', 'brainstorm', 'plan', 'implement', 'implement-direct', 'resume', 'ship'],
};
