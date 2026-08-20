import type { StandardsRuleView } from '@lightsout/engine';
import { Button } from '#src/common/components/ui/Button.tsx';
import { cn } from '#src/common/utils/cn.ts';

/** How this repo runs one rule, in the three words a row has space for. */
const RuleSettings = ({ rule }: { rule: StandardsRuleView }) => (
	<span className="flex flex-wrap items-center gap-x-1.5 text-muted-foreground text-xs">
		<span>{rule.checked ? 'code' : 'judgment'}</span>
		<span>·</span>
		<span>{rule.severity}</span>
		{rule.fromConfig ? <span className="text-status-running">· from config</span> : null}
	</span>
);

interface Props {
	rules: StandardsRuleView[];
	/** Findings in the latest snapshot, whatever rule they belong to — what the 'all rules' row counts. */
	findingCount: number;
	/** The rule the page is filtered to; absent means every finding is shown. */
	selected?: string;
	onSelect: (rule: string | undefined) => void;
	onOpenRule: (rule: string) => void;
}

/**
 * Every rule the repo's packages load, whether or not anything is wrong under
 * it.
 *
 * A rule nobody can find out about is a rule nobody follows, so a rule with no
 * open findings is still listed — dimmed, but present with its severity and
 * whether this repo's config set it. Rules the packages no longer load are
 * absent by construction: the view has no row for them, and their findings stay
 * reachable through the 'all rules' filter.
 *
 * Two controls per row rather than one, because a reader arrives with two
 * different questions: filter the findings to this rule, or read what the rule
 * actually says.
 */
export const RuleList = ({ rules, findingCount, selected, onSelect, onOpenRule }: Props) => (
	<ul aria-label="Rules" className="flex flex-col gap-0.5">
		<li>
			<button
				type="button"
				aria-pressed={selected === undefined}
				onClick={() => onSelect(undefined)}
				className={cn('flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent', {
					'bg-accent font-medium': selected === undefined,
				})}
			>
				<span>All rules</span>
				<span className="text-muted-foreground text-xs">{findingCount}</span>
			</button>
		</li>
		{rules.map((rule) => (
			<li key={rule.rule} className="flex items-center gap-1">
				<button
					type="button"
					aria-pressed={selected === rule.rule}
					onClick={() => onSelect(rule.rule)}
					className={cn('flex min-w-0 flex-1 flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent', {
						'bg-accent': selected === rule.rule,
						'opacity-60': rule.findingCount === 0,
					})}
				>
					<span className="flex items-center justify-between gap-2">
						<span className="min-w-0 truncate font-mono text-sm">{rule.rule}</span>
						<span className={cn('text-xs', rule.findingCount === 0 ? 'text-muted-foreground' : 'font-medium text-status-failed')}>
							{rule.findingCount === 0 ? '—' : rule.findingCount}
						</span>
					</span>
					<RuleSettings rule={rule} />
				</button>
				<Button type="button" variant="ghost" size="sm" aria-label={`rule text: ${rule.rule}`} onClick={() => onOpenRule(rule.rule)}>
					rule text
				</Button>
			</li>
		))}
	</ul>
);
