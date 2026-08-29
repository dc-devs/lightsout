import { type CommandCatalogEntry, CommandGroup, CommandRecordKind } from '#src/contracts/index.ts';

/** `/test-coverage-to-threshold` — the same two shapes as `/refactor`, over coverage rather than findings. */
export const testCoverageToThresholdCatalogEntry: CommandCatalogEntry = {
	id: 'test-coverage-to-threshold',
	slash: '/test-coverage-to-threshold',
	cli: 'lightsout test-coverage-to-threshold',
	group: CommandGroup.BurnDown,
	summary: 'Raise a repo’s unit-test coverage until its own coverage script passes, in verified, resumable batches via the lightsout coverage pipeline.',
	whenToUse:
		'Use it when the coverage gate is what stands between you and a green build. It writes tests in batches until your own coverage script passes, and stops there.',
	invocations: [{ id: 'test-coverage-to-threshold' }, { id: 'test-coverage-to-threshold-resume', note: 'resume a parked coverage run' }],
	flags: [
		{ name: 'run', value: '<id>', meaning: 'The parked coverage run to pick back up.', shape: 'test-coverage-to-threshold-resume', required: true },
		{ name: 'cwd', value: '<path>', meaning: 'Repository to raise coverage in.', fallback: 'The process working directory.', required: false },
		{
			name: 'max-batches',
			value: '<n>',
			meaning: 'Park the run after this many batches.',
			fallback: 'The run continues until the coverage script passes.',
			shape: 'test-coverage-to-threshold',
			required: false,
		},
		{ name: 'allow-dirty', meaning: 'Start even though the git tree has uncommitted changes.', shape: 'test-coverage-to-threshold', required: false },
	],
	steps: [],
	records: CommandRecordKind.Runs,
	related: ['refactor', 'standards-check'],
};
