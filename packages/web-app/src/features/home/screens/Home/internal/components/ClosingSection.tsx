import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import { FadeIn } from '#src/appUI/FadeIn.tsx';
import { GridBackground } from '#src/appUI/GridBackground.tsx';
import { GithubMark } from '#src/appUI/icons/GithubMark.tsx';
import { GridPattern } from '#src/common/constants/GridPattern.ts';
import { Wordmark } from '#src/features/app/components/Wordmark.tsx';
import { InstallLine } from '#src/features/home/components/InstallLine.tsx';

/** Where the project lives. */
const githubUrl = 'https://github.com/lightsout-factory/lightsout';

/**
 * The page's last word: the promise from How it works said once more, the same
 * install line the hero opens on, and where to read further — then the small
 * print. The hero's grid returns, fading in from the top this time, so the page
 * closes the way it opened; the footer under it sits on solid ground.
 */
export const ClosingSection = () => (
	<section className="w-full text-center">
		<div className="relative overflow-hidden px-4 py-32">
			<GridBackground
				pattern={GridPattern.Squares}
				maskImage="linear-gradient(to top, black 30%, transparent 100%)"
				className="z-0 opacity-60 dark:opacity-30"
			/>
			<div className="relative z-10 flex flex-col items-center">
				<FadeIn>
					<h2 className="font-extrabold text-5xl text-drop-navy tracking-tight md:text-6xl">
						Hand it off. <br />
						<span className="text-primary">Walk away.</span>
					</h2>
				</FadeIn>
				<FadeIn delayMs={100}>
					<p className="mt-6 max-w-2xl text-muted-foreground text-lg leading-relaxed">
						Install the plugin, <br />
						then run <code className="font-mono font-semibold text-drop-navy">/brainstorm</code> on your next ticket.
					</p>
				</FadeIn>
				<FadeIn delayMs={200}>
					<InstallLine className="mt-10" />
				</FadeIn>
				<FadeIn delayMs={300}>
					<div className="mt-8 flex items-center gap-6 font-semibold text-sm">
						<Link
							to="/docs/$doc"
							params={{ doc: 'configuration' }}
							className="inline-flex items-center gap-1.5 text-primary transition-colors hover:text-primary-hover"
						>
							Read the docs
							<ArrowRight aria-hidden="true" className="size-4" />
						</Link>
						<a
							href={githubUrl}
							target="_blank"
							rel="noreferrer"
							className="inline-flex items-center gap-1.5 text-drop-navy transition-colors hover:text-primary"
						>
							<GithubMark className="size-4" />
							GitHub
						</a>
					</div>
				</FadeIn>
			</div>
		</div>
		<footer className="border-border border-t bg-background px-4">
			<div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 py-8 text-muted-foreground text-sm">
				<div className="flex items-center gap-4">
					<Wordmark className="text-drop-navy" />
					<span>MIT License</span>
				</div>
				<a href={githubUrl} target="_blank" rel="noreferrer" className="transition-colors hover:text-drop-navy">
					github.com/lightsout-factory/lightsout
				</a>
			</div>
		</footer>
	</section>
);
