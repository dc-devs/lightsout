import type { StandardsRuleView } from '@lightsout/engine';

/** One group of counts, with the sentence that says what recorded them. */
const CountGroup = ({ title, note, counts }: { title: string; note: string; counts: [string, number][] }) => (
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
 * Every rule's counts added together — the only arithmetic this page does, and
 * only over numbers the engine already returned.
 *
 * `reasons` is deliberately dropped rather than concatenated. A reason is an
 * agent's sentence about one rule's site, and the pooled list would carry no
 * attribution — a decline explained for a size rule read as if it explained a
 * boundary rule. Reasons are worth reading against the rule they were recorded
 * for, so the block below shows them only when one rule is selected.
 */
const sumHistory = ({ rules }: { rules: StandardsRuleView[] }) =>
	rules.reduce<StandardsRuleView['history']>(
		(totals, { history }) => ({
			attempted: totals.attempted + history.attempted,
			resolved: totals.resolved + history.resolved,
			declined: totals.declined + history.declined,
			untracked: totals.untracked + history.untracked,
			adviceApplied: totals.adviceApplied + history.adviceApplied,
			adviceDeclined: totals.adviceDeclined + history.adviceDeclined,
			adviceAlreadyMet: totals.adviceAlreadyMet + history.adviceAlreadyMet,
			reasons: [],
		}),
		{ attempted: 0, resolved: 0, declined: 0, untracked: 0, adviceApplied: 0, adviceDeclined: 0, adviceAlreadyMet: 0, reasons: [] },
	);

interface Props {
	rules: StandardsRuleView[];
	/** The rule the page is filtered to; absent sums every rule so the panel is never blank. */
	selected?: string;
}

/**
 * What happened the last time agents met this rule's findings.
 *
 * The site counts and the advice counts are two separate groups and are never
 * added together. A site's fate is re-checked on disk after the batch that
 * worked it, while advice has only the agent's own word for it — one combined
 * number would let the stronger evidence hide behind the weaker, which is the
 * same reason the terminal's health table keeps them in separate columns.
 *
 * `untracked` is the honest bucket rather than a rounding error: a batch that
 * failed or never ran left its sites with no recorded fate, and counting those
 * as declines would blame a rule for an outage.
 */
export const RefactorHistoryPanel = ({ rules, selected }: Props) => {
	const rule = rules.find((entry) => entry.rule === selected);
	const history = rule?.history ?? sumHistory({ rules });
	const reasons = [...new Set(history.reasons.map((reason) => reason.replace(/\s+/g, ' ').trim()))].filter((reason) => reason.length > 0);

	return (
		<div className="flex flex-col gap-4">
			<p className="text-muted-foreground text-xs">{rule === undefined ? 'Every loaded rule, added together.' : `Recorded against ${rule.rule}.`}</p>
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
