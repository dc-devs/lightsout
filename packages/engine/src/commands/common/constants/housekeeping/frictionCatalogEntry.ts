import type { CommandCatalogEntry } from '#src/contracts/commands/CommandCatalogEntry.ts';
import { CommandGroup } from '#src/contracts/commands/CommandGroup.ts';
import { CommandRecordKind } from '#src/contracts/commands/CommandRecordKind.ts';

/** `lightsout friction` — reads what the runs already recorded, so it takes nothing but a repository. */
export const frictionCatalogEntry: CommandCatalogEntry = {
	id: 'friction',
	cli: 'lightsout friction',
	group: CommandGroup.Housekeeping,
	summary: 'Collect what slowed the agents down across recent runs, so the next fix is the one that pays.',
	whenToUse:
		'Reach for it after a few runs, when you want the next improvement to be the one that pays. It collects what actually slowed the agents down instead of what you assume did.',
	invocations: [{ id: 'friction' }],
	flags: [{ name: 'cwd', value: '<path>', meaning: 'Repository whose runs are read.', fallback: 'The process working directory.', required: false }],
	steps: [],
	records: CommandRecordKind.Nothing,
	related: ['status', 'doctor', 'improve', 'voice', 'report'],
};
