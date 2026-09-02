import { planSteps } from '#src/commands/common/constants/build/planSteps.ts';
import { type CommandCatalogEntry, CommandGroup, CommandRecordKind } from '#src/contracts/index.ts';

/** `/plan` — six subcommands under one command word, so it carries six invocations rather than one. */
export const planCatalogEntry: CommandCatalogEntry = {
	id: 'plan',
	slash: '/plan',
	cli: 'lightsout plan',
	group: CommandGroup.Build,
	summary: 'Produce a rigorous, implementation-ready plan for a feature — one a fresh-context agent can implement without guessing.',
	whenToUse:
		'Use it when you know what you want and need a plan a fresh agent could implement without guessing. It interviews you, drafts, grills the draft for edge cases, and grades the result before anyone writes code.',
	invocations: [
		{ id: 'plan-verify-facts', positional: 'verify-facts' },
		{ id: 'plan-draft', positional: 'draft' },
		{ id: 'plan-lint', positional: 'lint' },
		{ id: 'plan-dedup', positional: 'dedup' },
		{ id: 'plan-grade', positional: 'grade', note: '--phase grades only those phases, and always marks the result incomplete' },
		{ id: 'plan-publish', positional: 'publish' },
	],
	flags: [
		{ name: 'name', value: '<name>', meaning: 'The plan workspace to work in, under .lightsout/plans/.', required: true },
		{
			name: 'notes',
			value: '<path>',
			meaning: 'Rough notes to start from — a /brainstorm file, or anything you wrote yourself.',
			fallback: 'The workspace starts from the request alone.',
			shape: 'plan-verify-facts',
			required: false,
		},
		{
			name: 'scope',
			value: 'single|phased',
			meaning: 'Whether to write one plan or an overview with a file per phase.',
			fallback: 'Chosen from the size of the work.',
			shape: 'plan-draft',
			required: false,
		},
		{
			name: 'phase',
			value: '<n[,n]>',
			meaning: 'Grade only these phases of a phased plan.',
			fallback: 'Every phase is graded, and the result may be complete.',
			shape: 'plan-grade',
			required: false,
		},
		{ name: 'cwd', value: '<path>', meaning: 'Repository the plan workspace lives in.', fallback: 'The process working directory.', required: false },
	],
	steps: planSteps,
	records: CommandRecordKind.Plans,
	related: ['auto-plan', 'brainstorm', 'implement', 'resume', 'ship', 'implement-direct', 'queue'],
	graphic: {
		title: 'How /plan turns a request into an implementation-ready spec',
		subtitle: 'Final spec and every decision recorded before any code is written.',
		banner: 'The implementation-ready spec can now be handed to /implement in a fresh context window.',
		columns: 4,
	},
};
