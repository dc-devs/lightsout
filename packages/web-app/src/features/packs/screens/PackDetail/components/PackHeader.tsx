import type { StandardsPackView } from '@lightsout/engine';
import { Library } from 'lucide-react';
import { CopyButton, MetadataTag, PageHeader, SettingsCard } from '#src/appUI/index.ts';
import { hasPackFixtures } from '#src/features/packs/common/utils/hasPackFixtures.ts';

/** The `standards-packs` entry a repo would write to load this one pack. Named apart from the packs list's own builder, which takes every configured path at once. */
const buildOnePackConfigSnippet = ({ path }: { path: string }) => JSON.stringify({ 'standards-packs': [path] }, null, '\t');

/** How big the pack is, in the order a reader asks: how much of it, how much is mechanical, how it is organised, where it applies. */
const buildSizeLine = ({ pack }: { pack: StandardsPackView }) => {
	const channels = pack.channels.length === 0 ? 'no channels' : pack.channels.join(', ');

	return `${pack.totals.rules} rules · ${pack.totals.checked} enforced by code · ${pack.totals.documents} documents · ${channels}`;
};

interface Props {
	pack: StandardsPackView;
}

/**
 * What this pack is, how big it is, and what a repo writes to load it.
 *
 * The counts read as one sentence rather than a grid: this is the page about
 * one pack, so its size is context for everything below it rather than a figure
 * to compare against another card.
 *
 * A pack whose fixtures were stripped says so once, here, because that is the
 * reason the showcase strip is missing and the reason every rule row below
 * offers no code.
 */
export const PackHeader = ({ pack }: Props) => (
	<div className="flex flex-col gap-4">
		<PageHeader icon={Library} title={pack.name} description={pack.description} />
		<p className="text-muted-foreground text-sm">{buildSizeLine({ pack })}</p>
		{hasPackFixtures({ rules: pack.rules }) ? null : <p className="text-muted-foreground text-sm">This pack shipped without its fixtures.</p>}
		{pack.isDefault ? (
			<p className="text-sm">
				Loads when your config names no <MetadataTag>standards-packs</MetadataTag> — nothing to add.
			</p>
		) : (
			<SettingsCard
				title="Use this pack"
				description="Point lightsout.config.json at its folder. The path is relative to the repo root."
				action={<CopyButton value={buildOnePackConfigSnippet({ path: pack.path })} label="Copy config" />}
			>
				<pre className="overflow-x-auto font-mono text-muted-foreground-strong text-xs">{buildOnePackConfigSnippet({ path: pack.path })}</pre>
			</SettingsCard>
		)}
	</div>
);
