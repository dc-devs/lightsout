import { useSuspenseQuery } from '@tanstack/react-query';
import { defaultPackQueryOptions } from '#src/features/packs/queries/defaultPackQueryOptions.ts';
import { CheckKindKey } from '#src/features/packs/screens/PacksPage/components/CheckKindKey.tsx';
import { HowPacksLoad } from '#src/features/packs/screens/PacksPage/components/HowPacksLoad.tsx';
import { RuleSetCard } from '#src/features/packs/screens/PacksPage/components/RuleSetCard.tsx';
import { YourPackCard } from '#src/features/packs/screens/PacksPage/components/YourPackCard.tsx';

/**
 * The Standards Pack lightsout ships, as cards: one per set of rules it holds —
 * TypeScript, React, TanStack — each opening its rules, then a card for a
 * team's own.
 *
 * Static by design: this is what every repo gets out of the box, read from the
 * copy bundled into the app, so it reads the same on the web as on a machine
 * with a repo open. A set with no rules in it is never a card: the listing
 * counts rules per channel and leaves out a channel of prose alone.
 */
export const PacksPage = () => {
	const { data: pack } = useSuspenseQuery(defaultPackQueryOptions());

	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-14 px-4 py-20">
			<header className="flex flex-col gap-5">
				<h1 className="font-extrabold text-4xl text-drop-navy tracking-tight md:text-5xl">Standards Packs</h1>
				<p className="max-w-2xl text-lg text-muted-foreground leading-relaxed">
					A Standards Pack is the set of rules your agents follow, each enforced by a deterministic check or an agent check.
				</p>
				<CheckKindKey />
			</header>
			<div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
				{pack.channelTotals.map((total) => (
					<RuleSetCard key={total.channel} total={total} />
				))}
				<YourPackCard />
			</div>
			<HowPacksLoad />
		</div>
	);
};
