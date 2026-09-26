import type { StandardsPackRuleListing } from '@lightsout/engine';
import { StandardsSeverity } from '@lightsout/engine/contracts';
import { Link } from '@tanstack/react-router';
import { ChevronRight, OctagonX, TriangleAlert } from 'lucide-react';
import { CheckKind } from '#src/common/constants/CheckKind.ts';
import { checkKindIcons } from '#src/common/constants/checkKindIcons.ts';
import { checkKindLabels } from '#src/common/constants/checkKindLabels.ts';
import { cn } from '#src/common/utils/cn.ts';
import { toCheckKind } from '#src/common/utils/toCheckKind.ts';
import { CodeSpans } from '#src/features/packs/screens/RuleSetPage/internal/components/CodeSpans.tsx';

interface Props {
	rule: StandardsPackRuleListing;
	ruleSet: string;
}

/**
 * One rule as a row that opens it: its id and what it catches, its kind of check,
 * and whether it blocks a run or only advises.
 */
export const RuleRow = ({ rule, ruleSet }: Props) => {
	const isBlocking = rule.defaultSeverity === StandardsSeverity.Blocking;
	const SeverityIcon = isBlocking ? OctagonX : TriangleAlert;
	const kind = toCheckKind({ checked: rule.checked });
	const KindIcon = checkKindIcons[kind];

	return (
		<li>
			<Link
				to="/standards-packs/$ruleSet/$rule"
				params={{ ruleSet, rule: rule.id }}
				className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/40"
			>
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<span className="truncate font-mono font-semibold text-drop-navy text-sm">{rule.id}</span>
					<span className="text-muted-foreground text-sm">
						<CodeSpans text={rule.summary} />
					</span>
				</div>
				<div className="hidden shrink-0 items-center gap-2 sm:flex">
					<span
						className={cn(
							'inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-semibold text-xs',
							kind === CheckKind.Deterministic ? 'bg-primary-tint text-primary' : 'bg-agent-light text-agent-foreground',
						)}
					>
						<KindIcon aria-hidden="true" className="size-3.5" />
						{checkKindLabels[kind].short}
					</span>
					<span className="inline-flex w-20 items-center gap-1.5 font-medium text-muted-foreground text-xs">
						<SeverityIcon aria-hidden="true" className={cn('size-3.5', isBlocking ? 'text-status-failed' : 'text-status-running')} />
						{isBlocking ? 'Blocks' : 'Advises'}
					</span>
				</div>
				<ChevronRight aria-hidden="true" className="size-4 shrink-0 text-subtle-foreground transition-transform group-hover:translate-x-0.5" />
			</Link>
		</li>
	);
};
