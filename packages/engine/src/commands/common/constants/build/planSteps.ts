import { CommandActor, type CommandStep } from '#src/contracts/index.ts';

/**
 * The eight things `/plan` does, in the order a reader meets them — the cards
 * of its infographic and the headings of its manual page.
 *
 * They describe roles and obligations rather than a fixed run of subcommands,
 * because the engine decides from its own records which role runs next and how
 * often. A plan that already has a saved conclusion does not investigate again;
 * one whose inputs changed underneath it rechecks exactly what changed. So this
 * list is a description, never a schedule — nothing reads it to decide what to
 * do.
 */
export const planSteps: CommandStep[] = [
	{
		title: 'CAPTURE THE REQUEST AS IT WAS WRITTEN',
		actor: CommandActor.Engine,
		bullets: [
			'Record the original wording and where each line came from',
			'Record your own approving messages beside it',
			'Refuse to plan at all when there is no original request to plan from',
		],
		note: 'Keeps the plan answerable to what you actually asked for, not to a summary of it',
		saved: ['.lightsout/plans/<name>/.planning/'],
	},
	{
		title: 'INVESTIGATE WHAT THE CODE SAYS',
		actor: CommandActor.Engine,
		bullets: [
			'Open the files the request touches and record what was read',
			'Record what could not be established as an unknown, not as a guess',
			'Share each conclusion, so the next role reads it instead of re-deriving it',
		],
		note: 'Stops the plan resting on a signature nobody opened',
		saved: ['.lightsout/plans/<name>/.planning/'],
	},
	{
		title: 'SETTLE WHAT ONLY YOU CAN SETTLE',
		actor: CommandActor.You,
		bullets: [
			'A question carries the context, the options and a recommendation',
			'It is asked only when the answer is genuinely yours — a name, a behaviour, a cost',
			'Your answer is bound to the exact question it answers, and never asked again',
		],
		note: 'Keeps product decisions with you and best-practice decisions with the engine',
		saved: ['.lightsout/plans/<name>/.planning/'],
	},
	{
		title: 'CHALLENGE THE DESIGN BEFORE A LINE IS WRITTEN',
		actor: CommandActor.Engine,
		bullets: [
			'A reviewer who did not choose the design reads it against the original request',
			'Every failure scenario it raises becomes a finding with an owner',
			'Drafting waits until the design answers them',
		],
		note: 'The cheapest moment to reject a design is before anything is written from it',
		saved: ['.lightsout/plans/<name>/.planning/'],
	},
	{
		title: 'WRITE THE IMPLEMENTATION PLAN',
		actor: CommandActor.Engine,
		bullets: [
			'Turn the settled design into the files a fresh agent would need',
			'Name the exact acceptance obligation for each thing that must be true',
			'Write one plan, or an overview with a file per phase',
		],
		note: 'Creates the specification an implementation agent follows without guessing',
		saved: ['.lightsout/plans/<name>/plan.md', '.lightsout/plans/<name>/overview.md', '.lightsout/plans/<name>/phase<N>-<slug>.md'],
	},
	{
		title: 'CHALLENGE THE WRITTEN PLAN',
		actor: CommandActor.Engine,
		bullets: [
			'A reviewer reads the drafted plan against the original request again',
			'It names concrete scenarios the plan would get wrong, not style notes',
			'An obligation the plan dropped is a finding, however well the rest reads',
		],
		note: 'Catches what the drafting agent could not see in its own work',
		saved: ['.lightsout/plans/<name>/.planning/'],
	},
	{
		title: 'REPAIR EVERY FINDING, THEN REVIEW THE WHOLE',
		actor: CommandActor.Engine,
		bullets: [
			'Each finding is repaired and then verified by someone other than its repairer',
			'A genuine disagreement is adjudicated on the record rather than dropped',
			'One last reviewer reads the finished plan end to end',
		],
		note: 'Stops a plan that is locally repaired everywhere and coherent nowhere',
		saved: ['.lightsout/plans/<name>/.planning/'],
	},
	{
		title: 'RECORD READINESS, HAND OFF',
		actor: CommandActor.Engine,
		bullets: [
			'Readiness is derived from the records — nothing declares it',
			'An unmet obligation keeps the plan unready, whatever else passed',
			'The plan is published so a fresh context can implement it',
		],
		note: 'Planning readiness is not implementation verification, and never starts a build',
		saved: ['.lightsout/plans/<name>/.planning/'],
	},
];
