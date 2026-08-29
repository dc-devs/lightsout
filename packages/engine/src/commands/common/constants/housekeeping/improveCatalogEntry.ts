import { type CommandCatalogEntry, CommandGroup, CommandRecordKind } from '#src/contracts/index.ts';

/** `lightsout improve` — the one command that writes somewhere other than the repository it is pointed at. */
export const improveCatalogEntry: CommandCatalogEntry = {
	id: 'improve',
	cli: 'lightsout improve',
	group: CommandGroup.Housekeeping,
	summary: 'Feed this repo’s friction back to the lightsout engine as a change proposal.',
	whenToUse:
		'Use it when this repo’s friction is really the engine’s problem. It turns those findings into a change proposal against a lightsout checkout you point it at.',
	invocations: [{ id: 'improve' }],
	flags: [
		{ name: 'engine', value: '<lightsout-repo-path>', meaning: 'The lightsout checkout the change proposal is written against.', required: true },
		{ name: 'cwd', value: '<path>', meaning: 'Repository whose friction is read.', fallback: 'The process working directory.', required: false },
	],
	steps: [],
	records: CommandRecordKind.Nothing,
	related: ['status', 'doctor', 'friction', 'voice'],
};
