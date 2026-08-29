import { type CommandCatalogEntry, CommandGroup, CommandRecordKind } from '#src/contracts/index.ts';

/** `lightsout resume` — no skill ships for it, because it is the answer to a run that already stopped. */
export const resumeCatalogEntry: CommandCatalogEntry = {
	id: 'resume',
	cli: 'lightsout resume',
	group: CommandGroup.Build,
	summary: 'Pick a parked run back up where it stopped — same manifest, same work list, nothing repeated.',
	whenToUse:
		'Use it when a run parked — a rate limit, a batch ceiling, an escalation you have now answered. It restarts from the manifest, so finished work is never redone.',
	invocations: [{ id: 'resume' }],
	flags: [
		{ name: 'run', value: '<id>', meaning: 'The parked run to pick back up.', required: true },
		{ name: 'cwd', value: '<path>', meaning: 'Repository the run belongs to.', fallback: 'The process working directory.', required: false },
		{ name: 'skip-refactor', meaning: 'Skip the refactor step at the end of the run.', required: false },
	],
	steps: [],
	records: CommandRecordKind.Runs,
	related: ['auto-plan', 'brainstorm', 'plan', 'implement', 'ship', 'implement-direct', 'queue'],
};
