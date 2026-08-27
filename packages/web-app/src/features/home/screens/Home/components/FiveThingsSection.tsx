import { SectionHeader } from '#src/appUI/index.ts';

/**
 * The five claims only this product can make, in the order a reader feels them.
 *
 * Local to this file: page copy, not data anything else reads.
 */
const differences = [
	{
		title: 'The engine runs the gates, not the agent.',
		body: 'Lint, types, tests, coverage, build — run directly, exit codes decide. The agent cannot grade its own work.',
	},
	{
		title: 'Standards at every stage.',
		body: 'Your rules are injected into planning, implementation, tests and refactor — not pasted in a README the agent skims once.',
	},
	{
		title: 'Refactor is mandatory.',
		body: 'Every run ends with a cleanup pass against your standards, then the gates run again.',
	},
	{
		title: 'Evidence on disk.',
		body: 'Manifest, gate log, agent cost, transcripts. A green run can prove it. A failed run shows exactly where.',
	},
	{
		title: 'Your harness, your bill.',
		body: 'It spawns the Claude Code or Codex you already have. No new key, no proxy, no model in the middle.',
	},
];

export const FiveThingsSection = () => (
	<section className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-12 lg:px-10">
		<SectionHeader title="Five things nobody else does" />
		<div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-5">
			{differences.map((difference) => (
				<div key={difference.title} className="flex flex-col gap-2">
					<h3 className="font-medium text-sm">{difference.title}</h3>
					<p className="text-muted-foreground text-sm">{difference.body}</p>
				</div>
			))}
		</div>
	</section>
);
