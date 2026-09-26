import type { StandardsPackListing } from '@lightsout/engine';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Blocks } from 'lucide-react';
import { FrameworkMark } from '#src/appUI/icons/FrameworkMark.tsx';
import { CheckKind } from '#src/common/constants/CheckKind.ts';
import { checkKindLabels } from '#src/common/constants/checkKindLabels.ts';
import { describeChannel } from '#src/features/packs/internal/common/utils/describeChannel.ts';
import { toRuleSetSlug } from '#src/features/packs/internal/common/utils/toRuleSetSlug.ts';

type ChannelTotal = StandardsPackListing['channelTotals'][number];

interface Props {
	total: ChannelTotal;
}

/**
 * One set of rules in a pack — TypeScript, React, TanStack — as a card that
 * opens those rules: its logo, when it applies, how many rules it holds, and
 * how many are deterministic checks and how many agent checks.
 */
export const RuleSetCard = ({ total }: Props) => {
	const face = describeChannel({ channel: total.channel });
	const checkedShare = total.rules === 0 ? 0 : Math.round((total.checked / total.rules) * 100);

	return (
		<Link
			to="/standards-packs/$ruleSet"
			params={{ ruleSet: toRuleSetSlug({ channel: total.channel }) }}
			className="group flex flex-col gap-6 rounded-2xl border border-border bg-card p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary-tint-border hover:shadow-md"
		>
			<div className="flex items-start justify-between gap-3">
				<span className="flex size-11 items-center justify-center rounded-xl border border-border bg-muted/40">
					{face.framework === undefined ? (
						<Blocks aria-hidden="true" className="size-5 text-muted-foreground" />
					) : (
						<FrameworkMark framework={face.framework} className="size-6" />
					)}
				</span>
				<span className="rounded-full bg-muted px-2.5 py-1 font-semibold text-muted-foreground text-xs">{face.activation}</span>
			</div>
			<div className="flex flex-col gap-1">
				<h3 className="font-bold text-drop-navy text-xl">{face.name}</h3>
				<p className="text-muted-foreground text-sm">
					<span className="font-semibold text-drop-navy">{total.rules}</span> rules
				</p>
			</div>
			<div className="flex flex-col gap-2">
				<span aria-hidden="true" className="flex h-1.5 overflow-hidden rounded-full bg-agent-light">
					<span className="rounded-full bg-primary" style={{ width: `${checkedShare}%` }} />
				</span>
				<p className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground text-xs">
					<span className="inline-flex items-center gap-1.5">
						<span aria-hidden="true" className="size-2 rounded-full bg-primary" />
						{total.checked} {checkKindLabels[CheckKind.Deterministic].plural}
					</span>
					<span className="inline-flex items-center gap-1.5">
						<span aria-hidden="true" className="size-2 rounded-full bg-agent-border" />
						{total.judgment} {checkKindLabels[CheckKind.Agent].plural}
					</span>
				</p>
			</div>
			<span className="mt-auto inline-flex items-center gap-1 font-semibold text-primary text-sm">
				View rules
				<ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5" />
			</span>
		</Link>
	);
};
