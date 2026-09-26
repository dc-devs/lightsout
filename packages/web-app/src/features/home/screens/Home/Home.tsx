import { CleansAsItCodesSection } from '#src/features/home/screens/Home/internal/components/CleansAsItCodesSection/CleansAsItCodesSection.tsx';
import { ClosingSection } from '#src/features/home/screens/Home/internal/components/ClosingSection.tsx';
import { HeroSection } from '#src/features/home/screens/Home/internal/components/HeroSection.tsx';
import { HowItWorksSection } from '#src/features/home/screens/Home/internal/components/HowItWorksSection/HowItWorksSection.tsx';
import { ProofSection } from '#src/features/home/screens/Home/internal/components/ProofSection/ProofSection.tsx';
import { StandardsPacksSection } from '#src/features/home/screens/Home/internal/components/StandardsPacksSection/StandardsPacksSection.tsx';
import { TicketTrailSection } from '#src/features/home/screens/Home/internal/components/TicketTrailSection/TicketTrailSection.tsx';

/**
 * The seven sections, in the order a reader meets them. Named rather than keyed
 * on the function, whose name a minified build takes away. Each eases its own
 * blocks in, one after another, as it scrolls into view.
 */
const sections = [
	{ name: 'hero', Section: HeroSection },
	{ name: 'cleans-as-it-codes', Section: CleansAsItCodesSection },
	{ name: 'standards-packs', Section: StandardsPacksSection },
	{ name: 'how-it-works', Section: HowItWorksSection },
	{ name: 'proof', Section: ProofSection },
	{ name: 'ticket-trail', Section: TicketTrailSection },
	{ name: 'closing', Section: ClosingSection },
];

/**
 * The page that has to make a developer already annoyed at agent-written code
 * recognize the pain in the first screen, and install from it.
 *
 * It suspends on nothing. Every section reads bundled source — the copy is in
 * the components, the workflows are the engine's own command catalog, the proof
 * is a committed run, and the pack's live numbers arrive through a query that is
 * allowed to fail. A build with no repository under it renders all of it.
 */
export const Home = () => (
	<div className="flex flex-col">
		{sections.map(({ name, Section }) => (
			<Section key={name} />
		))}
	</div>
);
