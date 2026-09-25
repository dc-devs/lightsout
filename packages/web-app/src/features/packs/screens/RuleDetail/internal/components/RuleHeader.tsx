import type { StandardsPackRuleView } from '@lightsout/engine';
import { Badge } from '#src/appUI/badges/Badge.tsx';
import { MetadataTag } from '#src/appUI/badges/MetadataTag.tsx';
import { severityBadgeVariants } from '#src/common/constants/severityBadgeVariants.ts';

interface Props {
	rule: StandardsPackRuleView;
}

/**
 * The rule's identity: what it catches, and the four facts that decide where it
 * applies and how loudly.
 *
 * These are the pack's own defaults rather than how any one repo runs the rule
 * — a repo's config can lower a severity, and that belongs on the page about
 * the repo.
 */
export const RuleHeader = ({ rule }: Props) => (
	<header className="flex flex-col gap-3">
		<h1 className="font-mono font-semibold text-2xl">{rule.id}</h1>
		<p className="max-w-3xl text-sm leading-6">{rule.summary}</p>
		<div className="flex flex-wrap items-center gap-2">
			<Badge>{rule.checked ? 'enforced by code' : 'judgment'}</Badge>
			<Badge variant={severityBadgeVariants[rule.defaultSeverity]}>{rule.defaultSeverity} by default</Badge>
			<MetadataTag>{rule.channel}</MetadataTag>
			<MetadataTag>{rule.set}</MetadataTag>
		</div>
	</header>
);
