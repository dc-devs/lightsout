import { implementSteps } from '#src/commands/common/constants/implementSteps.ts';
import { type CommandCatalogEntry, CommandGroup, CommandRecordKind } from '#src/contracts/index.ts';

/** `/implement` — one plan file or a whole plan workspace, which is why `--plan` appears twice with different placeholders. */
export const implementCatalogEntry: CommandCatalogEntry = {
	id: 'implement',
	slash: '/implement',
	cli: 'lightsout implement',
	group: CommandGroup.Build,
	summary: 'Run the lightsout deterministic implementation pipeline on a plan file.',
	whenToUse:
		'Run it when a plan is graded and you want the work done unattended. Every step is gated by the repo’s own tests, lint, types and coverage, and the run parks rather than pushing past a gate it cannot satisfy.',
	invocations: [{ id: 'implement' }, { id: 'implement-folder', note: 'folder: overview.md runs all phases, else plan.md' }],
	flags: [
		{ name: 'plan', value: '<path>', meaning: 'The plan file to implement.', shape: 'implement', required: true },
		{
			name: 'overview',
			value: '<path>',
			meaning: 'The overview this plan is one phase of, so the run reads the wider intent.',
			fallback: 'The plan is implemented on its own.',
			shape: 'implement',
			required: false,
		},
		{
			name: 'packages',
			value: '<a,b>',
			meaning: 'Comma-separated package names the gates are scoped to.',
			fallback: 'The packages the run actually changed files in.',
			shape: 'implement',
			required: false,
		},
		{
			name: 'plan',
			value: '<folder>',
			meaning: 'A plan workspace folder — overview.md runs every phase as a child run, plan.md runs the one.',
			shape: 'implement-folder',
			required: true,
		},
		{
			name: 'start-phase',
			value: '<n>',
			meaning: 'The phase number a phased run begins at.',
			fallback: 'The first phase that has not already passed.',
			shape: 'implement-folder',
			required: false,
		},
		{ name: 'cwd', value: '<path>', meaning: 'Repository to implement in.', fallback: 'The process working directory.', required: false },
		{ name: 'skip-refactor', meaning: 'Skip the refactor step at the end of the run.', required: false },
		{ name: 'ship', meaning: 'Ship the branch after the run passes: open or adopt the PR, wait for checks, merge, clean up.', required: false },
	],
	steps: implementSteps,
	records: CommandRecordKind.Runs,
	related: ['auto-plan', 'brainstorm', 'plan', 'resume', 'ship'],
	graphic: {
		title: 'How /implement turns the spec into verified code',
		subtitle: 'Ten steps, deterministic gates throughout, and a complete record saved to disk.',
		banner: 'The model can claim success. Lightsout requires evidence.',
		columns: 5,
	},
};
