import { Link } from '@tanstack/react-router';
import { Button, GridBackground, SectionBadge } from '#src/appUI/index.ts';
import { heroDescription } from '#src/features/home/common/constants/heroDescription.ts';
import { InstallLine } from '#src/features/home/components/InstallLine.tsx';
import { SprawlChart } from '#src/features/sprawl/index.ts';

/**
 * The pain, and the picture.
 *
 * Left, the sentence a reader who has watched an agent work should recognize;
 * right, the animation of this repository's own history, which is the one thing
 * a screenshot cannot show. The gradient falls on a single word — the second of
 * the three places it is spent — because a page that neons everything says
 * nothing.
 */
export const HeroSection = () => (
	<section className="relative overflow-hidden px-6 py-16 lg:px-10 lg:py-24">
		<GridBackground />
		<div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 lg:grid-cols-2">
			<div className="flex flex-col items-start gap-6">
				<SectionBadge>lightsout · a gated factory for coding agents</SectionBadge>
				<h1 className="font-semibold text-4xl leading-tight lg:text-6xl">
					Stop the <span className="bg-[image:var(--brand-gradient)] bg-clip-text text-transparent">slop</span>.
				</h1>
				<p className="max-w-xl text-base text-muted-foreground-strong">{heroDescription}</p>
				<p className="max-w-xl text-base text-muted-foreground-strong">
					Lightsout makes repository quality part of the work — and proves it with your own tests, not the agent’s word.
				</p>
				<div className="flex w-full flex-col items-start gap-3 sm:flex-row sm:items-center">
					<InstallLine className="w-full sm:w-auto" />
					<Button variant="outline" asChild>
						<Link to="/standards/$pack" params={{ pack: 'lightsout-defaults' }}>
							See what the standards look like →
						</Link>
					</Button>
				</div>
			</div>
			<SprawlChart className="min-w-0" />
		</div>
	</section>
);
