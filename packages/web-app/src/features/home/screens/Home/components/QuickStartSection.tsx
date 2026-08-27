import { CopyButton, CtaBanner } from '#src/appUI/index.ts';
import { InstallLine } from '#src/features/home/components/InstallLine.tsx';

/** The smallest config that runs: the three gates, and nothing else. */
const minimalConfig = `{
  "gates": {
    "check": "pnpm check",
    "test": "pnpm test:unit",
    "test-coverage": "pnpm test:unit:coverage"
  }
}`;

/** Install, configure, run — the last thing the page asks for. */
export const QuickStartSection = () => (
	<section className="mx-auto w-full max-w-6xl px-6 py-12 lg:px-10">
		<CtaBanner title="Start with three gates and one command." description="Pre-alpha. It runs the harness you already have.">
			<InstallLine className="w-full max-w-md" />
			<div className="flex w-full max-w-md flex-col gap-2 text-left">
				<div className="flex items-center justify-between gap-2">
					<span className="font-mono text-muted-foreground text-xs">lightsout.config.json</span>
					<CopyButton value={minimalConfig} label="Copy config" />
				</div>
				<pre className="overflow-x-auto rounded-md bg-muted p-3 text-left font-mono text-[0.7rem] text-muted-foreground-strong leading-5">{minimalConfig}</pre>
			</div>
			{/* Written out rather than mapped: three fixed lines of page copy, in the order they are meant to be typed. */}
			<ol className="flex w-full max-w-md flex-col gap-1 text-left">
				<li className="flex flex-wrap items-baseline gap-2 text-sm">
					<code className="font-mono text-foreground">/brainstorm</code>
					<span className="text-muted-foreground text-xs">shape the idea until it is buildable</span>
				</li>
				<li className="flex flex-wrap items-baseline gap-2 text-sm">
					<code className="font-mono text-foreground">/plan</code>
					<span className="text-muted-foreground text-xs">settle every decision, then grade the plan</span>
				</li>
				<li className="flex flex-wrap items-baseline gap-2 text-sm">
					<code className="font-mono text-foreground">/implement</code>
					<span className="text-muted-foreground text-xs">hand it to the factory and walk away</span>
				</li>
			</ol>
			<p className="text-muted-foreground text-xs">
				Pre-alpha · MIT ·{' '}
				<a href="https://github.com/dc-devs/lightsout" target="_blank" rel="noreferrer" className="underline underline-offset-4">
					GitHub
				</a>
			</p>
		</CtaBanner>
	</section>
);
