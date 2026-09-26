import { type LucideIcon, Power, ScanSearch, SlidersHorizontal } from 'lucide-react';

/** How a pack's rules come to apply to a repo, each a real behaviour of the engine. */
const ways: Array<{ title: string; body: string; Icon: LucideIcon }> = [
	{ title: 'Always on', body: 'The TypeScript rules apply to every repo.', Icon: Power },
	{ title: 'Switch on by themselves', body: 'React and TanStack rules turn on when the packages a run touches depend on them.', Icon: ScanSearch },
	{ title: 'Yours to tune', body: 'Set any deterministic check to block, advise or off in lightsout.config.json.', Icon: SlidersHorizontal },
];

/** The short strip under the cards: when a pack's rules apply, and how a team changes that. */
export const HowPacksLoad = () => (
	<section aria-labelledby="how-packs-load" className="flex flex-col gap-6 border-border border-t pt-12">
		<h2 id="how-packs-load" className="font-bold text-drop-navy text-lg">
			How packs load
		</h2>
		<ul className="grid grid-cols-1 gap-8 md:grid-cols-3">
			{ways.map(({ title, body, Icon }) => (
				<li key={title} className="flex items-start gap-4">
					<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-tint text-primary">
						<Icon aria-hidden="true" className="size-4" />
					</span>
					<div className="flex flex-col gap-1">
						<h3 className="font-semibold text-drop-navy text-sm">{title}</h3>
						<p className="text-muted-foreground text-sm leading-relaxed">{body}</p>
					</div>
				</li>
			))}
		</ul>
	</section>
);
