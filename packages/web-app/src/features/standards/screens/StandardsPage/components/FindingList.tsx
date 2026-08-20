import type { StandardsFinding } from '@lightsout/engine';
import { FindingCard } from '#src/features/standards/screens/StandardsPage/components/FindingCard.tsx';

interface Props {
	findings: StandardsFinding[];
	/** Rule ids the repo's packages still load — a finding outside this set has no prose to open. */
	loadedRules: string[];
	/** The rule the page is filtered to, so an empty result can say which question it answered. */
	selected?: string;
	onOpenRule: (rule: string) => void;
}

/**
 * The findings the current filter leaves, as cards.
 *
 * An empty result says so in words. A blank region reads as a page that failed
 * to load, and 'nothing open under this rule' is the answer a reader came for
 * just as often as a list is.
 */
export const FindingList = ({ findings, loadedRules, selected, onOpenRule }: Props) => {
	const loaded = new Set(loadedRules);

	return findings.length === 0 ? (
		<p className="text-muted-foreground text-sm">{selected === undefined ? 'Nothing is open in the latest snapshot.' : `Nothing is open under ${selected}.`}</p>
	) : (
		<div className="flex flex-col gap-2">
			{findings.map((finding) => (
				<FindingCard key={`${finding.rule}:${finding.siteKey}`} finding={finding} loaded={loaded.has(finding.rule)} onOpenRule={onOpenRule} />
			))}
		</div>
	);
};
