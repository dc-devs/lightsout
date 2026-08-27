import { Link } from '@tanstack/react-router';
import { SettingsCard } from '#src/appUI/index.ts';

/**
 * How a shop writes its own pack, for a reader who has just read what the
 * bundled ones hold.
 *
 * A pack is a folder of markdown, so the shape of that folder is the whole
 * explanation — a rule that also ships a check adds `check.ts` and a pair of
 * fixture folders beside its `rule.md`.
 *
 * The contracts package is linked by URL rather than by route: it is source in
 * this repo, and this app serves no page for it.
 */
export const WriteYourOwnCard = () => {
	// The smallest pack that loads: a manifest, a set, a document, a rule.
	const packShape = `my-standards/
├─ lightsout-standards.json      name, description, homepage
└─ code/                         the set
   └─ house-rules/               the document
      └─ 05-loose-file/rule.md   the rule`;

	return (
		<SettingsCard title="Write your own" description="A pack is a folder. Point the config at it and its rules stack beside these.">
			<pre className="overflow-x-auto font-mono text-muted-foreground-strong text-xs">{packShape}</pre>
			<p className="mt-3 flex flex-wrap gap-3 text-sm">
				<Link to="/docs/$doc" params={{ doc: 'configuration' }} className="text-brand-to underline underline-offset-4">
					Configuration
				</Link>
				<Link to="/docs/$doc" params={{ doc: 'configuration' }} hash="adding-your-standards" className="text-brand-to underline underline-offset-4">
					Adding your standards
				</Link>
				<a
					href="https://github.com/dc-devs/lightsout/tree/main/packages/standards-contracts"
					target="_blank"
					rel="noreferrer"
					className="text-brand-to underline underline-offset-4"
				>
					What a check receives →
				</a>
			</p>
		</SettingsCard>
	);
};
