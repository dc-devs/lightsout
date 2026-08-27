import type { ConfigView } from '@lightsout/engine';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { FileCog } from 'lucide-react';
import { Badge, MetadataTag, PageHeader, SettingsCard } from '#src/appUI/index.ts';
import { BadgeVariant } from '#src/common/constants/BadgeVariant.ts';
import { configQueryOptions } from '#src/features/config/queries/configQueryOptions.ts';
import { ConfigFieldRow } from '#src/features/config/screens/ConfigPage/components/ConfigFieldRow.tsx';
import { RuleLedger } from '#src/features/config/screens/ConfigPage/components/RuleLedger.tsx';

/** One loaded pack, as the way into what it says and which framework documents it carries. */
const PackRow = ({ pack }: { pack: ConfigView['packs'][number] }) => (
	<div className="flex flex-wrap items-center gap-2 border-border border-b py-3 first:pt-0 last:border-0 last:pb-0">
		<Link to="/standards/$pack" params={{ pack: pack.name }} className="font-medium text-sm hover:underline hover:underline-offset-2">
			{pack.name}
		</Link>
		{pack.isDefault ? <Badge variant={BadgeVariant.Neutral}>default</Badge> : null}
		<MetadataTag className="min-w-0 truncate" title={pack.rootPath}>
			{pack.rootPath}
		</MetadataTag>
		<span className="flex flex-wrap gap-1">
			{pack.channels.map((channel) => (
				<Badge key={channel} variant={BadgeVariant.Neutral}>
					{channel}
				</Badge>
			))}
		</span>
	</div>
);

/**
 * What this repo told lightsout, and what lightsout filled in.
 *
 * A viewer rather than an editor, deliberately: the file is the record, and a
 * page that could write it would be a second author of run state. What the page
 * adds is the half a reader cannot get by opening the file — which values they
 * never chose, and which rules those values produced.
 */
export const ConfigPage = () => {
	const { data: view } = useSuspenseQuery(configQueryOptions());

	return (
		<div className="flex flex-col gap-4 p-6">
			<PageHeader icon={FileCog} title="Config" description={<span className="font-mono">{view.path}</span>} />
			{view.sections.map((section) => (
				<SettingsCard key={section.title} title={section.title}>
					<div className="flex flex-col">
						{section.fields.map((field) => (
							<ConfigFieldRow key={field.key} field={field} />
						))}
					</div>
				</SettingsCard>
			))}
			<SettingsCard title="Standards packs loaded" description="What a run works against here, and where each pack was read from.">
				{view.packs.length === 0 ? (
					<p className="text-muted-foreground text-sm">No pack loads here — `standards-packs` is set to false.</p>
				) : (
					<div className="flex flex-col">
						{view.packs.map((pack) => (
							<PackRow key={pack.name} pack={pack} />
						))}
					</div>
				)}
			</SettingsCard>
			<SettingsCard title="Rules" description="Every loaded rule at the state it runs at here — the same ledger `standards-check --list` prints.">
				<RuleLedger ruleStates={view.ruleStates} />
			</SettingsCard>
			<Link to="/docs/$doc" params={{ doc: 'configuration' }} className="text-brand-to text-sm underline underline-offset-4">
				What every key means →
			</Link>
		</div>
	);
};
