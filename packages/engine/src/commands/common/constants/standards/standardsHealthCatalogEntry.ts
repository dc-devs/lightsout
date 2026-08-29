import { type CommandCatalogEntry, CommandGroup, CommandRecordKind } from '#src/contracts/index.ts';

/** `lightsout standards-health` — reads the run history rather than the code, so it takes nothing but a repository. */
export const standardsHealthCatalogEntry: CommandCatalogEntry = {
	id: 'standards-health',
	cli: 'lightsout standards-health',
	group: CommandGroup.Standards,
	summary: 'Report each rule’s coverage and how often agents decline it — which standards are actually holding.',
	whenToUse:
		'Reach for it when you suspect a standard is decorative — declared, but never enforced in practice. It shows per-rule coverage and how often agents decline the rule when asked to fix it.',
	invocations: [{ id: 'standards-health', note: 'per-rule coverage and how often agents decline it' }],
	flags: [{ name: 'cwd', value: '<path>', meaning: 'Repository to report on.', fallback: 'The process working directory.', required: false }],
	steps: [],
	records: CommandRecordKind.Nothing,
	related: ['standards-check', 'standards-validate'],
};
