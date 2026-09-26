import { CircleCheck, Coins } from 'lucide-react';
import { FadeIn, JiraMark, LinearMark } from '#src/appUI/index.ts';
import { SectionPill } from '#src/features/home/components/SectionPill.tsx';
import { TicketMock } from '#src/features/home/screens/Home/components/TicketTrailSection/components/TicketMock.tsx';

/**
 * What lightsout writes to a team's tracker today — each a real behaviour of
 * the ticket workflow, worded the way a lead reading this page would care
 * about it.
 */
const trail = [
	{
		title: 'Every decision, attached',
		body: 'The brainstorm design, the plan and every decision behind them land on the ticket as files, written automatically.',
	},
	{ title: 'Status that keeps itself current', body: 'Planning and implementation status update on the ticket as the work moves.' },
	{ title: 'Tickets drafted, you approve', body: 'Lightsout drafts new tickets, and files one only once you say so.' },
];

/**
 * The enterprise case: a tracker that becomes the record of what the agents
 * decided, why, and who signed off — where the team already looks. Anything
 * not built yet is marked as coming, never claimed.
 */
export const TicketTrailSection = () => (
	<section className="relative w-full overflow-hidden px-4 py-24">
		<div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 lg:grid-cols-2">
			<div>
				<FadeIn>
					<SectionPill
						label={
							<>
								<LinearMark className="size-4" />
								Linear
								<span aria-hidden="true" className="px-1">
									·
								</span>
								<JiraMark className="size-4" />
								Jira
							</>
						}
						className="mb-8"
					/>
				</FadeIn>
				<FadeIn delayMs={100}>
					<h2 className="font-extrabold text-4xl text-drop-navy tracking-tight md:text-5xl">
						Every decision, <br />
						<span className="text-primary">recorded on your ticket.</span>
					</h2>
				</FadeIn>
				<FadeIn delayMs={200}>
					<p className="mt-6 max-w-lg text-muted-foreground text-lg leading-relaxed">
						Each ticket becomes its own audit trail: what was decided, why, and by whom, attached where your team already looks.
					</p>
				</FadeIn>
				<FadeIn delayMs={300}>
					<ul className="mt-10 flex flex-col gap-6">
						{trail.map((item) => (
							<li key={item.title} className="flex items-start gap-4">
								<CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
								<div>
									<h3 className="font-bold text-drop-navy text-sm">{item.title}</h3>
									<p className="mt-1 text-muted-foreground text-sm leading-relaxed">{item.body}</p>
								</div>
							</li>
						))}
						<li className="flex items-start gap-4">
							<Coins aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-subtle-foreground" />
							<div>
								<h3 className="flex items-center gap-2 font-bold text-drop-navy text-sm">
									Agent cost on every ticket
									<span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 font-semibold text-[10px] text-muted-foreground uppercase tracking-widest">
										Coming soon
									</span>
								</h3>
								<p className="mt-1 text-muted-foreground text-sm leading-relaxed">What each ticket cost to build, where your team plans the next one.</p>
							</div>
						</li>
					</ul>
				</FadeIn>
			</div>
			<FadeIn delayMs={200}>
				<TicketMock />
			</FadeIn>
		</div>
	</section>
);
