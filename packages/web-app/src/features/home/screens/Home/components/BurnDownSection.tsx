import { SectionHeader } from '#src/appUI/index.ts';

/**
 * The two commands that work on code a repo already has.
 *
 * The links point at the skill files on GitHub rather than at
 * `/commands/$command`, which does not exist yet — a `Link` to a path with no
 * route behind it lands a reader in the not-found panel. The command catalog
 * phase swaps them.
 */
const commands = [
	{
		name: '/refactor',
		body: 'Turns your standards findings into gated, resumable cleanup batches with a measured before and after.',
		href: 'https://github.com/dc-devs/lightsout/blob/main/plugin/skills/refactor/SKILL.md',
	},
	{
		name: '/test-coverage-to-threshold',
		body: 'Raises coverage until your own coverage command passes.',
		href: 'https://github.com/dc-devs/lightsout/blob/main/plugin/skills/test-coverage-to-threshold/SKILL.md',
	},
];

export const BurnDownSection = () => (
	<section className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-12 lg:px-10">
		<SectionHeader title="Not just new features" description="Two commands aimed at the code that is already there." />
		<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
			{commands.map((command) => (
				<article key={command.name} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
					<h3 className="font-medium font-mono text-sm">{command.name}</h3>
					<p className="text-muted-foreground text-sm">{command.body}</p>
					<a href={command.href} target="_blank" rel="noreferrer" className="text-brand-to text-sm underline underline-offset-4">
						What it does →
					</a>
				</article>
			))}
		</div>
	</section>
);
