import type { StandardsRuleView } from '@lightsout/engine';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Badge, SettingsCard } from '#src/appUI/index.ts';
import { ruleStateBadgeVariants } from '#src/common/constants/ruleStateBadgeVariants.ts';
import { formatCount } from '#src/common/formatting/formatCount.ts';
import { standardsQueryOptions } from '#src/features/standards/index.ts';

/** One group of recorded counts, with the sentence that says what recorded them. */
const CountGroup = ({ title, note, counts }: { title: string; note: string; counts: Array<[string, number]> }) => (
	<div className="flex flex-col gap-1">
		<span className="font-medium text-sm">{title}</span>
		<span className="text-muted-foreground text-xs leading-5">{note}</span>
		<ul className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
			{counts.map(([label, count]) => (
				<li key={label} className="flex items-baseline gap-1.5">
					<span className="text-muted-foreground text-xs">{label}</span>
					<span className="font-medium text-sm">{count}</span>
				</li>
			))}
		</ul>
	</div>
);

/**
 * What happened the last time agents met this rule's findings here.
 *
 * Sites and advice are never added together: a site's fate is re-checked on disk
 * after the batch that worked it, while advice has only the agent's own word for
 * it. `untracked` is the honest bucket rather than a rounding error — a batch
 * that failed left its sites with no recorded fate, and counting those as
 * declines would blame the rule for an outage.
 */
const RuleHistory = ({ history }: { history: StandardsRuleView['history'] }) => {
	const reasons = [...new Set(history.reasons.map((reason) => reason.replace(/\s+/g, ' ').trim()))].filter((reason) => reason.length > 0);

	return (
		<div className="flex flex-col gap-4">
			<CountGroup
				title="Sites"
				note="Blocking findings frozen into a refactor work-list, then re-checked on disk afterwards."
				counts={[
					['attempted', history.attempted],
					['resolved', history.resolved],
					['declined', history.declined],
					['untracked', history.untracked],
				]}
			/>
			<CountGroup
				title="Advice"
				note="Advisory and agent-review findings, as the agent reported answering them."
				counts={[
					['applied', history.adviceApplied],
					['declined', history.adviceDeclined],
					['already met', history.adviceAlreadyMet],
				]}
			/>
			{reasons.length === 0 ? null : (
				<div className="flex flex-col gap-1">
					<span className="font-medium text-sm">Reasons recorded</span>
					<ul className="flex flex-col gap-1">
						{reasons.map((reason) => (
							<li key={reason} className="border-border border-l-2 pl-3 text-muted-foreground text-xs leading-5">
								{reason}
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
};

interface Props {
	ruleId: string;
}

/**
 * How this rule runs in the repository the app has open — the one section of the
 * rule page that is not the same everywhere.
 *
 * Subscribes rather than suspends, and renders nothing at all when the answer is
 * empty. The public build holds no repository, and every rule page there has to
 * read as a complete page rather than as one with a hole where a local section
 * would go.
 */
export const RuleInThisRepo = ({ ruleId }: Props) => {
	const { data: view } = useQuery(standardsQueryOptions());
	const rule = view?.rules.find((entry) => entry.rule === ruleId);

	return rule === undefined ? null : (
		<SettingsCard title="In this repo" description="What the repository the app has open does with this rule.">
			<div className="flex flex-col gap-4">
				<div className="flex flex-wrap items-center gap-2 text-sm">
					<Badge variant={ruleStateBadgeVariants[rule.severity]}>{rule.severity}</Badge>
					<span className="text-muted-foreground">{rule.fromConfig ? "set by this repo's config" : 'as the pack ships it'}</span>
					<Link to="/repo/standards" search={{ rule: rule.rule }} className="text-brand-to underline underline-offset-4">
						{formatCount({ count: rule.findingCount, noun: 'open finding' })} →
					</Link>
				</div>
				<RuleHistory history={rule.history} />
			</div>
		</SettingsCard>
	);
};
