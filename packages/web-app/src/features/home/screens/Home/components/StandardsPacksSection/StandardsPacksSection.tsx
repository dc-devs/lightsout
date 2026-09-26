import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Blocks, BookCheck, ClipboardPen, Code, type LucideIcon, OctagonX, Plus, ToggleLeft, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { FadeIn, FrameworkMark } from '#src/appUI/index.ts';
import { Framework } from '#src/common/constants/Framework.ts';
import { cn } from '#src/common/utils/cn.ts';
import { SectionPill } from '#src/features/home/components/SectionPill.tsx';
import { PackStats } from '#src/features/home/screens/Home/components/StandardsPacksSection/components/PackStats.tsx';
import { defaultPackQueryOptions } from '#src/features/packs/index.ts';

/** The three steps a pack is built into, and what it does in each. */
const steps: Array<{ name: string; body: string; Icon: LucideIcon }> = [
	{ name: 'Plan', body: 'Your rules shape the plan before any code exists.', Icon: ClipboardPen },
	{ name: 'Implement', body: 'The agent writes code to the same rules.', Icon: Code },
	{ name: 'Refactor', body: 'Anything that breaks them is cleaned up before the run ends.', Icon: Blocks },
];

/**
 * Where each card's share of the branch line runs, so the three together draw
 * one line across from the first card's middle to the last's. The 0.75rem
 * reaches halfway into the gap on either side.
 */
const branchSpans = ['left-1/2 -right-3', '-left-3 -right-3', '-left-3 right-1/2'];

/** The rule sets the default pack ships, in the order a reader looks for them; the framework ones switch on when a repo uses the framework. */
const frameworks = [
	{ framework: Framework.TypeScript, name: 'TypeScript' },
	{ framework: Framework.React, name: 'React' },
	{ framework: Framework.TanStack, name: 'TanStack' },
];

/** The three settings a repo gives each rule, in the colour each carries everywhere in lightsout. */
const severities: Array<{ label: string; meaning: string; Icon: LucideIcon; iconClass: string }> = [
	{ label: 'Block', meaning: 'stops the run', Icon: OctagonX, iconClass: 'text-status-failed-foreground' },
	{ label: 'Advise', meaning: 'flags it for the agent', Icon: TriangleAlert, iconClass: 'text-status-running' },
	{ label: 'Off', meaning: 'not checked', Icon: ToggleLeft, iconClass: 'text-subtle-foreground' },
];

/** A card on the lower row: a small title over its contents. */
const Panel = ({ title, children }: { title: string; children: ReactNode }) => (
	<div className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-sm lg:p-8">
		<h3 className="font-bold text-drop-navy text-lg">{title}</h3>
		{children}
	</div>
);

/**
 * Why lightsout can clean as it codes: the Standards Pack — the rules the
 * agents follow, built into every step rather than pasted into a README, some
 * deterministic checks and some agent checks, ready-made or your own.
 * The pack's numbers are read live and allowed to be missing.
 */
export const StandardsPacksSection = () => {
	const { data: defaultPack } = useQuery(defaultPackQueryOptions());

	return (
		<section className="relative w-full px-4 py-24">
			<div className="mx-auto flex max-w-6xl flex-col gap-14">
				<div className="flex flex-col items-center text-center">
					<FadeIn>
						<SectionPill icon={BookCheck} label="Standards Packs" className="mb-8" />
					</FadeIn>
					<FadeIn delayMs={100}>
						<h2 className="font-extrabold text-4xl text-drop-navy tracking-tight md:text-5xl">
							Your standards, <br />
							<span className="text-primary">enforced at every step.</span>
						</h2>
					</FadeIn>
					<FadeIn delayMs={200}>
						<p className="mt-6 max-w-2xl text-muted-foreground text-lg leading-relaxed">
							A Standards Pack is the set of rules your agents follow, built into planning, implementation and refactoring, and checked on every change.
						</p>
					</FadeIn>
				</div>
				<FadeIn delayMs={300}>
					<div className="flex flex-col items-center gap-4 lg:gap-0">
						<SectionPill icon={BookCheck} label="Your Standards Pack" />
						<span aria-hidden="true" className="hidden h-8 w-px bg-muted-foreground/30 lg:block" />
						<ol className="grid w-full grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-6">
							{steps.map(({ name, body, Icon }, index) => (
								<li key={name} className="relative flex flex-col lg:pt-8">
									<span aria-hidden="true" className={cn('absolute top-0 hidden h-px bg-muted-foreground/30 lg:block', branchSpans[index])} />
									<span aria-hidden="true" className="absolute top-0 left-1/2 hidden h-8 w-px bg-muted-foreground/30 lg:block" />
									<div className="flex flex-1 flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
										<span className="flex size-9 items-center justify-center rounded-lg bg-primary-tint text-primary">
											<Icon aria-hidden="true" className="size-4" />
										</span>
										<h3 className="font-bold text-base text-drop-navy">{name}</h3>
										<p className="text-muted-foreground text-sm leading-relaxed">{body}</p>
									</div>
								</li>
							))}
						</ol>
					</div>
				</FadeIn>
				<FadeIn delayMs={400}>
					<div className="grid grid-cols-1 gap-6 md:grid-cols-2">
						<Panel title="More than a linter">
							<PackStats pack={defaultPack} />
							<div className="flex flex-col gap-3">
								<p className="text-muted-foreground text-sm">Each rule is yours to set:</p>
								<ul className="flex flex-wrap gap-x-6 gap-y-2">
									{severities.map(({ label, meaning, Icon, iconClass }) => (
										<li key={label} title={meaning} className="inline-flex items-center gap-2 font-semibold text-drop-navy text-sm">
											<Icon aria-hidden="true" className={cn('size-4', iconClass)} />
											{label}
										</li>
									))}
								</ul>
							</div>
						</Panel>
						<Panel title="Ready-made, or roll your own">
							<ul className="grid auto-rows-fr grid-cols-2 gap-3 sm:grid-cols-3">
								{frameworks.map(({ framework, name }) => (
									<li
										key={framework}
										className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-3 font-medium text-foreground text-sm shadow-sm"
									>
										<FrameworkMark framework={framework} className="size-5 shrink-0" />
										{name}
									</li>
								))}
								<li className="flex items-center gap-2.5 rounded-lg border border-primary-tint-border border-dashed bg-card px-4 py-3 font-medium text-primary-hover text-sm">
									<Plus aria-hidden="true" className="size-5 shrink-0" />
									Your team’s pack
								</li>
							</ul>
							<p className="text-muted-foreground text-sm leading-relaxed">
								Framework rules switch on when your repo uses the framework. Write your own rules, and use them alone or stack them on ours.
							</p>
							<Link
								to="/standards-packs"
								className="inline-flex items-center gap-1 font-semibold text-primary text-sm transition-colors hover:text-primary-hover"
							>
								Browse Standards Packs
								<ArrowRight aria-hidden="true" className="size-4" />
							</Link>
						</Panel>
					</div>
				</FadeIn>
			</div>
		</section>
	);
};
