import { refactorSteps } from '#src/commands/common/constants/refactorSteps.ts';
import { type CommandCatalogEntry, CommandGroup, CommandRecordKind } from '#src/contracts/index.ts';

/** `/refactor` — a fresh burn-down or the resumption of a parked one, which is why `--run` belongs to only the second shape. */
export const refactorCatalogEntry: CommandCatalogEntry = {
	id: 'refactor',
	slash: '/refactor',
	cli: 'lightsout refactor',
	group: CommandGroup.BurnDown,
	summary:
		'Burn down a repo’s standards-check findings (duplication, size, structure, boundary violations) in verified, resumable batches via the lightsout refactor pipeline.',
	whenToUse:
		'Reach for it when standards-check has more findings than anyone will fix by hand. It burns them down in verified, resumable batches, each one gated before it lands.',
	invocations: [{ id: 'refactor' }, { id: 'refactor-resume', note: 'resume a parked refactor run' }],
	flags: [
		{ name: 'run', value: '<id>', meaning: 'The parked refactor run to pick back up.', shape: 'refactor-resume', required: true },
		{ name: 'cwd', value: '<path>', meaning: 'Repository to burn down.', fallback: 'The process working directory.', required: false },
		{ name: 'path', value: '<subdir>', meaning: 'Burn down only this subdirectory.', fallback: 'The whole repository.', shape: 'refactor', required: false },
		{ name: 'all', meaning: 'Include findings the baseline has already accepted as known debt.', shape: 'refactor', required: false },
		{
			name: 'max-batches',
			value: '<n>',
			meaning: 'Park the run after this many batches.',
			fallback: 'The run continues until the work-list is finished.',
			shape: 'refactor',
			required: false,
		},
		{ name: 'code-checks', meaning: 'Build the work-list from the mechanical checks alone, with no agent review.', shape: 'refactor', required: false },
		{ name: 'allow-dirty', meaning: 'Start even though the git tree has uncommitted changes.', shape: 'refactor', required: false },
	],
	steps: refactorSteps,
	records: CommandRecordKind.Runs,
	related: ['test-coverage-to-threshold', 'standards-check'],
	graphic: {
		title: 'How /refactor turns standards findings into verified cleanup',
		subtitle: 'Twelve steps, one batch at a time, every fix re-checked and re-gated before the next begins.',
		banner: 'The engine never commits. It hands back a measured before-and-after and a diff you review.',
		columns: 4,
	},
};
