import { type CommandCatalogEntry, CommandGroup, CommandRecordKind } from '#src/contracts/index.ts';

/** `lightsout standards-validate` — a pack author’s gate, which is why its only flag names a pack folder. */
export const standardsValidateCatalogEntry: CommandCatalogEntry = {
	id: 'standards-validate',
	cli: 'lightsout standards-validate',
	group: CommandGroup.Standards,
	summary: 'Run every rule’s check against its own fixtures, so a rule that no longer detects what it claims fails loudly.',
	whenToUse:
		'Run it after writing or editing a rule, and in CI for a pack you ship. It proves each check still passes its own pass fixtures and still fails its fail fixtures.',
	invocations: [{ id: 'standards-validate', note: 'run every check against its own fixtures' }],
	flags: [
		{ name: 'pack', value: '<path>', meaning: 'Validate only the pack at this folder.', fallback: 'Every pack the config loads.', required: false },
		{ name: 'cwd', value: '<path>', meaning: 'Repository whose packs are validated.', fallback: 'The process working directory.', required: false },
	],
	steps: [],
	records: CommandRecordKind.Nothing,
	related: ['standards-check', 'standards-health'],
};
