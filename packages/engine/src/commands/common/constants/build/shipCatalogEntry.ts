import { type CommandCatalogEntry, CommandGroup, CommandRecordKind } from '#src/contracts/index.ts';

/** `lightsout ship` — no skill ships for it; the tracker skill that reads its result file is separate work. */
export const shipCatalogEntry: CommandCatalogEntry = {
	id: 'ship',
	cli: 'lightsout ship',
	group: CommandGroup.Build,
	summary: 'Take the current branch from committed work to merged and cleaned up, and write a typed result.',
	whenToUse:
		'Run it when the branch is committed and you want it merged: it pushes the branch, opens or adopts the pull request, waits for the checks, merges, deletes the branch and syncs the default branch — then writes one JSON result a tracker skill can read.',
	invocations: [{ id: 'ship' }],
	flags: [{ name: 'cwd', value: '<path>', meaning: 'Repository to ship from.', fallback: 'The process working directory.', required: false }],
	steps: [],
	records: CommandRecordKind.Nothing,
	related: ['auto-plan', 'brainstorm', 'plan', 'implement', 'resume', 'implement-direct', 'queue', 'ticket-state'],
};
