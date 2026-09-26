import { Sparkles } from 'lucide-react';
import { FadeIn } from '#src/appUI/FadeIn.tsx';
import { GridBackground } from '#src/appUI/GridBackground.tsx';
import { GridPattern } from '#src/common/constants/GridPattern.ts';
import { InstallLine } from '#src/features/home/components/InstallLine.tsx';
import { SectionPill } from '#src/features/home/components/SectionPill.tsx';
import { heroDescription } from '#src/features/home/internal/common/constants/heroDescription.ts';

/**
 * The promise, in three words, and the one thing to do about it.
 *
 * It fills the first screen under the header, so the next section waits below
 * the fold rather than competing with the headline. Styled to FeedbackDrop's
 * hero, class for class: the faint grid fading toward
 * the page, the blue pill badge, a navy headline with its last word in blue,
 * the grey sub line saying plainly what it is, one pill-shaped action and
 * the small print under it — each block rising in on its own delay.
 */
export const HeroSection = () => (
	<section className="relative flex min-h-[calc(100svh-4.5rem)] w-full flex-col items-center justify-center px-4 py-16 text-center">
		<GridBackground
			pattern={GridPattern.Squares}
			maskImage="linear-gradient(to bottom, black 40%, transparent 100%)"
			className="z-0 opacity-60 dark:opacity-30"
		/>
		<div className="relative z-10 flex flex-col items-center">
			<FadeIn>
				<SectionPill icon={Sparkles} label="lightsout · Quality control for AI coding agents" className="mb-10" />
			</FadeIn>
			<FadeIn delayMs={100}>
				<h1 className="max-w-4xl font-extrabold text-6xl leading-[1.1] tracking-tight md:text-8xl">
					<span className="text-drop-navy">Stop the </span>
					<span className="text-primary">slop.</span>
				</h1>
			</FadeIn>
			<FadeIn delayMs={200}>
				<p className="mt-8 max-w-2xl text-muted-foreground-strong text-lg leading-relaxed md:text-xl">{heroDescription}</p>
			</FadeIn>
			<FadeIn delayMs={300}>
				<InstallLine className="mt-10" />
			</FadeIn>
			<FadeIn delayMs={400}>
				<p className="mt-6 text-muted-foreground text-sm">Alpha · MIT · Works with Claude Code, Codex, and Pi</p>
			</FadeIn>
		</div>
	</section>
);
