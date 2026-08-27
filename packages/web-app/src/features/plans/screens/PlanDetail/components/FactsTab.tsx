import type { ExploreArea, PlanFacts } from '@lightsout/engine/contracts';
import { MetadataTag, SettingsCard } from '#src/appUI/index.ts';
import { formatCount } from '#src/common/formatting/formatCount.ts';
import { formatRelativeTime } from '#src/common/formatting/formatRelativeTime.ts';

/** One list of facts under its own heading; a list nothing was recorded for is left out rather than shown empty. */
const FactList = ({ title, items }: { title: string; items: Array<{ key: string; lead: string; note: string }> }) =>
	items.length === 0 ? null : (
		<div className="flex flex-col gap-1">
			<h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">{title}</h4>
			<ul className="flex flex-col gap-1 text-sm">
				{items.map((item) => (
					<li key={item.key} className="flex flex-wrap items-baseline gap-2">
						<MetadataTag>{item.lead}</MetadataTag>
						<span className="text-muted-foreground">{item.note}</span>
					</li>
				))}
			</ul>
		</div>
	);

/** What one explorer agent confirmed by reading the codebase, before any of it was planned. */
const AreaCard = ({ area }: { area: ExploreArea }) => (
	<SettingsCard title={area.area} description={area.namingConvention}>
		<div className="flex flex-col gap-3">
			<FactList title="Affected packages" items={area.affectedPackages.map((name) => ({ key: name, lead: name, note: '' }))} />
			<FactList title="Files to modify" items={area.filesToModify.map((file) => ({ key: file.path, lead: file.path, note: file.role }))} />
			<FactList
				title="Patterns to mirror"
				items={area.patternsToMirror.map((pattern) => ({ key: pattern.path, lead: pattern.path, note: pattern.takeaway }))}
			/>
			<FactList
				title="Integration points"
				items={area.integrationPoints.map((point) => ({ key: `${point.name}:${point.at}`, lead: point.name, note: `${point.signature} — ${point.at}` }))}
			/>
			<FactList title="Scripts" items={area.scripts.map((script) => ({ key: script.key, lead: script.key, note: script.command }))} />
		</div>
	</SettingsCard>
);

interface Props {
	facts?: PlanFacts;
}

/**
 * The verified facts a plan was drafted from: what was asked for, what each
 * explorer found, and the deterministic on-disk check of every path they named.
 */
export const FactsTab = ({ facts }: Props) => {
	if (facts === undefined) {
		return <p className="text-muted-foreground text-sm">No facts recorded — run lightsout plan verify-facts --name &lt;name&gt;.</p>;
	}

	const { missingPaths, missingScripts, pathsChecked, scriptsChecked } = facts.verification;

	return (
		<div className="flex flex-col gap-4">
			<p className="text-sm">{facts.request}</p>
			{facts.areas.map((area) => (
				<AreaCard key={area.area} area={area} />
			))}
			<SettingsCard title="Verification" description={`Checked on disk ${formatRelativeTime({ at: facts.verifiedAt })}`}>
				<ul className="flex flex-col gap-1 text-sm">
					<li>{formatCount({ count: pathsChecked, noun: 'path' })} checked</li>
					<li className={missingPaths.length === 0 ? 'text-muted-foreground' : 'text-status-failed'}>
						{missingPaths.length === 0 ? 'every path was there' : `missing: ${missingPaths.join(', ')}`}
					</li>
					<li>{formatCount({ count: scriptsChecked, noun: 'script' })} checked</li>
					<li className={missingScripts.length === 0 ? 'text-muted-foreground' : 'text-status-failed'}>
						{missingScripts.length === 0 ? 'every script was there' : `missing: ${missingScripts.join(', ')}`}
					</li>
				</ul>
			</SettingsCard>
		</div>
	);
};
