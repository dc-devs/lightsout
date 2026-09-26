import { ArrowRight, Bot, ChevronRight, CircleCheck, Workflow } from 'lucide-react';
import type { ReactNode } from 'react';
import { FadeIn } from '#src/appUI/FadeIn.tsx';
import { cn } from '#src/common/utils/cn.ts';
import { SectionPill } from '#src/features/home/components/SectionPill.tsx';
import { FlowActor } from '#src/features/home/screens/Home/internal/components/HowItWorksSection/internal/common/constants/FlowActor.ts';
import { FlowStepCard } from '#src/features/home/screens/Home/internal/components/HowItWorksSection/internal/components/FlowStepCard.tsx';

/** What `/brainstorm` works through with you — everything above the level of code. */
const brainstormCovers = ['Product design', 'Architecture', 'Edge cases'];

/** What `/plan` produces and proves — each a real step of the planning pipeline. */
const planCovers = [
	'Technical implementation, step by step',
	'Grilled on every edge case, one question at a time',
	'Facts checked against your code',
	'Duplicates caught before coding',
];

/**
 * The stages `/implement` runs, in order, with the gates run between every one.
 * The acceptance tests come first, written from the plan's test ledger when the
 * plan carries one.
 */
const implementStages = ['Writes locked acceptance tests', 'Implements the code', 'Writes tests', 'Refactors'];

/** What `ship` does once asked, in order — the last two only after the merge is confirmed. */
const shipStages = [
	'Pushes the branch and opens the pull request',
	'Waits for your CI, then merges',
	'Moves the ticket to Done',
	'Removes the worktree and deletes the branch',
];

/** A step's contents as a short ticked list under its line, so each card shows the real work it does. */
const CheckList = ({ items }: { items: string[] }) => (
	<ul className="flex flex-col gap-1.5 border-border/60 border-t pt-3 text-muted-foreground-strong text-xs">
		{items.map((item) => (
			<li key={item} className="flex items-start gap-2">
				<CircleCheck aria-hidden="true" className="mt-px size-3.5 shrink-0 text-status-passed" />
				{item}
			</li>
		))}
	</ul>
);

/** The arrow between two cards in a zone: right on a wide screen, down on a narrow one. */
const StepArrow = () => <ChevronRight aria-hidden="true" className="size-5 shrink-0 rotate-90 self-center text-subtle-foreground/60 lg:rotate-0" />;

/** One side of the handoff: a tinted panel named for who works in it, holding that side's steps. */
const Zone = ({ label, tone, children }: { label: string; tone: FlowActor; children: ReactNode }) => (
	<div
		className={cn(
			'flex flex-col gap-4 rounded-3xl border p-4 sm:p-5',
			tone === FlowActor.You ? 'border-primary-tint-border/60 bg-primary-tint/40' : 'border-agent-border/60 bg-agent-light/40',
		)}
	>
		<p className={cn('font-semibold text-xs uppercase tracking-widest', tone === FlowActor.You ? 'text-primary-hover' : 'text-agent-foreground')}>{label}</p>
		<div className="flex flex-1 flex-col items-stretch gap-2 lg:flex-row">{children}</div>
	</div>
);

/** The moment the work changes hands, between the two zones. */
const Handoff = () => (
	<div className="flex items-center justify-center gap-2 lg:flex-col">
		<span className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30">
			<ArrowRight aria-hidden="true" className="size-5 rotate-90 lg:rotate-0" />
		</span>
		<span className="font-semibold text-primary-hover text-xs uppercase tracking-widest">Hand off</span>
	</div>
);

/**
 * Who does what, as the flow a reader actually runs: the two steps a person
 * decides, the handoff, and the two an agent executes — the headline drawn as
 * two zones, so the split reads at a glance.
 */
export const HowItWorksSection = () => (
	<section className="relative w-full px-4 py-24">
		<div className="mx-auto flex max-w-6xl flex-col gap-14">
			<div className="flex flex-col items-center text-center">
				<FadeIn>
					<SectionPill icon={Workflow} label="How it works" className="mb-8" />
				</FadeIn>
				<FadeIn delayMs={100}>
					<h2 className="font-extrabold text-4xl text-drop-navy tracking-tight md:text-5xl">
						Humans decide. <br />
						<span className="text-primary">Agents execute.</span>
					</h2>
				</FadeIn>
				<FadeIn delayMs={200}>
					<p className="mt-6 max-w-2xl text-muted-foreground text-lg leading-relaxed">Settle every decision with the agent. Hand it off. Walk away.</p>
				</FadeIn>
			</div>
			<FadeIn delayMs={300}>
				<div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[1fr_auto_1fr]">
					<Zone label="You decide" tone={FlowActor.You}>
						<FlowStepCard
							command="/brainstorm"
							actor={FlowActor.You}
							body="Works through the whole design and stress-tests it with you before any code detail is settled."
						>
							<CheckList items={brainstormCovers} />
						</FlowStepCard>
						<StepArrow />
						<FlowStepCard
							command="/plan"
							actor={FlowActor.You}
							body="Turns the design into a build spec an agent with a fresh context window can implement exactly as planned."
						>
							<CheckList items={planCovers} />
							<p className="flex items-start gap-2 border-border/60 border-t pt-3 text-muted-foreground text-xs leading-relaxed">
								<Bot aria-hidden="true" className="mt-px size-3.5 shrink-0 text-agent" />
								<span>
									or <code className="font-mono font-semibold text-drop-navy">/auto-plan</code>: the agent runs the plan step itself, answering the questions
									with its own recommendations and checking with you only on the big calls.
								</span>
							</p>
						</FlowStepCard>
					</Zone>
					<Handoff />
					<Zone label="Agents execute" tone={FlowActor.Agent}>
						<FlowStepCard
							command="/implement"
							actor={FlowActor.Agent}
							body="Builds the plan. A locked test ledger and deterministic gates keep the agent on track."
						>
							<CheckList items={implementStages} />
						</FlowStepCard>
						<StepArrow />
						<FlowStepCard
							command="ship"
							actor={FlowActor.Agent}
							isOptional
							body="Takes the finished branch all the way to merged, then cleans up your workspace."
						>
							<CheckList items={shipStages} />
						</FlowStepCard>
					</Zone>
				</div>
			</FadeIn>
		</div>
	</section>
);
