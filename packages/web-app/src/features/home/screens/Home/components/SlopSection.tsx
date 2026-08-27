import { SectionHeader } from '#src/appUI/index.ts';

/**
 * Three symptoms, each with the code that shows it.
 *
 * `before` is what the repo already had; `after` is what an agent wrote beside
 * it. No fix is shown — this section names the pain, and the answer to it is
 * the rest of the page.
 *
 * Local to this file rather than a shared constant: three single-use values that
 * are page copy, not data anything else reads.
 */
const symptoms = [
	{
		title: 'Missed the helper. Wrote another.',
		before: 'export const formatDuration = ({ ms }: Params): string => …',
		after: `const msToLabel = (ms: number) => \`\${Math.round(ms / 1000)}s\`;`,
	},
	{
		title: 'A second pattern beside the first.',
		before: 'if (!run) throw new RunNotFoundError({ runId });',
		after: 'if (!run) return { ok: false as const };',
	},
	{
		title: 'Copied the shortcut it found.',
		before: 'const config = JSON.parse(raw) as any; // typed later, never was',
		after: 'const settings = JSON.parse(text) as any; // matches config.ts',
	},
];

/** One symptom: what it is called, what was already there, and what landed next to it. */
const SymptomPanel = ({ title, before, after }: { title: string; before: string; after: string }) => (
	<article className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4">
		<h3 className="font-medium text-sm">{title}</h3>
		<pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-[0.7rem] text-muted-foreground leading-5">{before}</pre>
		<pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-[0.7rem] text-status-failed leading-5">{after}</pre>
	</article>
);

export const SlopSection = () => (
	<section className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-12 lg:px-10">
		<SectionHeader title="Name the slop" description="Three things a reader who has watched an agent work will recognize." />
		<div className="grid grid-cols-1 items-start gap-4 md:grid-cols-3">
			{symptoms.map((symptom) => (
				<SymptomPanel key={symptom.title} title={symptom.title} before={symptom.before} after={symptom.after} />
			))}
		</div>
		<p className="font-medium text-base">And it compounds. The mess becomes the context the next agent reads.</p>
	</section>
);
