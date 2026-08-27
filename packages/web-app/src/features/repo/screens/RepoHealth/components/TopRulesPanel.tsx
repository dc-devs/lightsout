import type { StandardsRuleView } from '@lightsout/engine';
import { Link } from '@tanstack/react-router';
import { SettingsCard, ShareBar } from '#src/appUI/index.ts';
import { formatCount } from '#src/common/formatting/formatCount.ts';

interface Props {
	/** Every loaded rule, as the standards view returned them. Required: the page does not mount this panel until it has them. */
	rules: StandardsRuleView[];
}

/**
 * Which rules this repo is breaking most, as bars.
 *
 * Rules with nothing open are dropped before the top five is taken. Five
 * zero-length bars read as data at a glance, and a clean check is the outcome
 * the whole product is selling — so it is said in words instead.
 *
 * Every count is `findingCount` off the engine's own view; nothing here counts
 * findings for itself.
 */
export const TopRulesPanel = ({ rules }: Props) => {
	// How many rules a glance holds.
	const topRuleCount = 5;
	const top = rules
		.filter((rule) => rule.findingCount > 0)
		.sort((first, second) => second.findingCount - first.findingCount || first.rule.localeCompare(second.rule))
		.slice(0, topRuleCount);
	const largest = top.length === 0 ? 0 : top[0].findingCount;

	return (
		<SettingsCard title="Top rules by findings" description="Where the open findings are concentrated right now.">
			{top.length === 0 ? (
				<p className="text-muted-foreground text-sm">No findings.</p>
			) : (
				<ul className="flex flex-col gap-2">
					{top.map((rule) => (
						<li key={rule.rule} className="flex flex-col gap-1">
							<Link to="/repo/standards" search={{ rule: rule.rule }} className="flex items-baseline justify-between gap-3 text-sm hover:underline">
								<span className="min-w-0 truncate font-mono">{rule.rule}</span>
								<span className="whitespace-nowrap text-muted-foreground text-xs">{formatCount({ count: rule.findingCount, noun: 'finding' })}</span>
							</Link>
							<ShareBar value={rule.findingCount} max={largest} />
						</li>
					))}
				</ul>
			)}
		</SettingsCard>
	);
};
