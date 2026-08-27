import { FadeIn } from '#src/appUI/index.ts';
import { BurnDownSection } from '#src/features/home/screens/Home/components/BurnDownSection.tsx';
import { FiveThingsSection } from '#src/features/home/screens/Home/components/FiveThingsSection.tsx';
import { FixSection } from '#src/features/home/screens/Home/components/FixSection.tsx';
import { HeroSection } from '#src/features/home/screens/Home/components/HeroSection.tsx';
import { ProofSection } from '#src/features/home/screens/Home/components/ProofSection.tsx';
import { QuickStartSection } from '#src/features/home/screens/Home/components/QuickStartSection.tsx';
import { SlopSection } from '#src/features/home/screens/Home/components/SlopSection.tsx';
import { SprawlSection } from '#src/features/home/screens/Home/components/SprawlSection.tsx';
import { StandardsSection } from '#src/features/home/screens/Home/components/StandardsSection.tsx';

/** The nine sections, in the order a reader meets them. Named rather than keyed on the function, whose name a minified build takes away. */
const sections = [
	{ name: 'hero', Section: HeroSection },
	{ name: 'slop', Section: SlopSection },
	{ name: 'fix', Section: FixSection },
	{ name: 'five-things', Section: FiveThingsSection },
	{ name: 'sprawl', Section: SprawlSection },
	{ name: 'standards', Section: StandardsSection },
	{ name: 'burn-down', Section: BurnDownSection },
	{ name: 'proof', Section: ProofSection },
	{ name: 'quick-start', Section: QuickStartSection },
];

/**
 * The page that has to make a developer already annoyed at agent-written code
 * recognize the pain in the first screen, and install in the last.
 *
 * It suspends on nothing. Every section reads bundled source — the copy is in
 * the components, the animation is a committed dataset, the demo runs are
 * committed JSON, and the pack's live numbers arrive through a query that is
 * allowed to fail. A build with no repository under it renders all of it.
 */
export const Home = () => {
	// Small enough that the sections read as one page arriving rather than a queue.
	const revealStepMs = 60;

	return (
		<div className="flex flex-col">
			{sections.map(({ name, Section }, index) => (
				<FadeIn key={name} delayMs={index * revealStepMs}>
					<Section />
				</FadeIn>
			))}
		</div>
	);
};
