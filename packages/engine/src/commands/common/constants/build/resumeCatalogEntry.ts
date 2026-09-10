import { type CommandCatalogEntry, CommandGroup, CommandRecordKind } from '#src/contracts/index.ts';

/** `lightsout resume` — no skill ships for it, because it is the answer to a run that already stopped. */
export const resumeCatalogEntry: CommandCatalogEntry = {
	id: 'resume',
	cli: 'lightsout resume',
	group: CommandGroup.Build,
	summary: 'Pick a parked run back up where it stopped, in the workspace that run recorded — same manifest, same work list, nothing repeated.',
	whenToUse:
		'Use it when a run parked — a rate limit, a batch ceiling, an escalation you have now answered. It restarts from the manifest, so finished work is never redone, and it returns to the checkout that run recorded rather than the one you happen to be standing in. A direct run built from a ticket is continued here too: it picks its unfinished stage back up from the ticket frozen beside the run, rather than being re-run from the ticket file.',
	invocations: [{ id: 'resume' }],
	flags: [
		{ name: 'run', value: '<id>', meaning: 'The parked run to pick back up.', required: true },
		{ name: 'cwd', value: '<path>', meaning: 'Repository the run belongs to.', fallback: 'The process working directory.', required: false },
		{ name: 'skip-refactor', meaning: 'Skip the refactor step at the end of the run.', required: false },
		{ name: 'ship', meaning: 'Ship the branch after the resumed run passes: open or adopt the PR, wait for checks, merge, clean up.', required: false },
		{ name: 'no-ship', meaning: 'End on the run result even when the config’s `ship.after-implement` asks to chain into ship.', required: false },
	],
	steps: [],
	records: CommandRecordKind.Runs,
	related: ['auto-plan', 'brainstorm', 'plan', 'implement', 'ship', 'implement-direct', 'queue', 'ticket-state', 'self-check'],
};
