import { type CommandCatalogEntry, CommandGroup, CommandRecordKind } from '#src/contracts/index.ts';

/** `lightsout standards-check` — the check itself, and `--list`, which prints the ledger and checks nothing. */
export const standardsCheckCatalogEntry: CommandCatalogEntry = {
	id: 'standards-check',
	cli: 'lightsout standards-check',
	group: CommandGroup.Standards,
	summary: 'Check the repo against its standards packs and report every finding, machine checks and agent review alike.',
	whenToUse:
		'Run it to see where the repo stands against its packs, before a refactor or after one. `--list` prints the enforcement ledger instead: which rules are blocking, which advisory, which off.',
	invocations: [{ id: 'standards-check' }, { id: 'standards-check-list', note: 'print the enforcement ledger' }],
	flags: [
		{ name: 'list', meaning: 'Print the enforcement ledger — blocking, advisory, off — and check nothing.', shape: 'standards-check-list', required: true },
		{ name: 'cwd', value: '<path>', meaning: 'Repository to check.', fallback: 'The process working directory.', required: false },
		{ name: 'path', value: '<subdir>', meaning: 'Check only this subdirectory.', fallback: 'The whole repository.', shape: 'standards-check', required: false },
		{ name: 'all', meaning: 'Include findings the baseline has already accepted as known debt.', shape: 'standards-check', required: false },
		{ name: 'baseline', meaning: 'Write the findings to the baseline file as accepted debt.', shape: 'standards-check', required: false },
		{ name: 'code-checks', meaning: 'Run the mechanical checks only.', shape: 'standards-check', required: false, exclusiveWith: 'half' },
		{ name: 'agent-review', meaning: 'Run the agent review only.', shape: 'standards-check', required: false, exclusiveWith: 'half' },
	],
	steps: [],
	records: CommandRecordKind.Snapshots,
	related: ['standards-validate', 'standards-health', 'refactor', 'test-coverage-to-threshold'],
};
