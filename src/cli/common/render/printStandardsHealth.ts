import type { StandardsHealth, StandardsHealthRule } from '@/standardsCheck';
import { renderTable } from '@/cli/common/render/renderTable';
import { bold } from '@/cli/common/terminal/bold';
import { dim } from '@/cli/common/terminal/dim';

/** Longest a recorded reason may print before it is cut — one long rationale must not stretch the whole table. */
const reasonWidth = 96;

const count = ({ value }: { value: number }) => (value === 0 ? '—' : `${value}`);

/** A share of a total, or '—' when nothing was ever put to the test — an unasked question has no answer, and 0% would read as one. */
const rate = ({ part, total }: { part: number; total: number }) => (total === 0 ? '—' : `${Math.round((part / total) * 100)}%`);

/** Each distinct reason once, cut to the column width — the same rationale repeats across a rule's batches. */
const reasonLines = ({ reasons }: { reasons: string[] }) =>
	[...new Set(reasons.map((reason) => reason.replace(/\s+/g, ' ').trim()))]
		.filter((reason) => reason.length > 0)
		.map((reason) => (reason.length > reasonWidth ? `${reason.slice(0, reasonWidth - 1)}…` : reason));

const ruleRows = ({ rule }: { rule: StandardsHealthRule }) => {
	const advice = rule.adviceApplied + rule.adviceDeclined;

	return [
		{
			cells: [
				rule.id,
				rule.checked ? 'code' : 'judgment',
				count({ value: rule.attempted }),
				count({ value: rule.resolved }),
				count({ value: rule.declined }),
				count({ value: rule.untracked }),
				rate({ part: rule.declined, total: rule.attempted }),
				count({ value: advice }),
				rate({ part: rule.adviceDeclined, total: advice }),
			],
		},
		...reasonLines({ reasons: rule.reasons }).map((reason) => ({
			cells: [`· ${reason}`, '', '', '', '', '', '', '', ''],
			ruleAbove: false,
			emphasis: dim,
		})),
	];
};

const sum = ({ rules, of }: { rules: StandardsHealthRule[]; of: (rule: StandardsHealthRule) => number }) =>
	rules.reduce((total, rule) => total + of(rule), 0);

interface Params {
	health: StandardsHealth;
}

/**
 * The package-health report, as a table.
 *
 * Two accounts sit side by side and are never added together. `sites` and the
 * three columns after it are blocking work: frozen into a refactor run's
 * work-list, re-checked on disk afterwards, so `resolved` and `declined` are
 * measured rather than reported. `advice` is everything an agent was merely
 * shown — machine advisories and the agent review's own findings alike — where
 * the only record is the agent's own answer. Mixing them would let the
 * measured half vouch for the reported half.
 *
 * `untracked` is the honest bucket: a batch that failed, was parked, or never
 * ran left its sites with no recorded fate, and counting those as declines
 * would blame a rule for an outage.
 *
 * Every recorded reason prints dim beneath its rule, because a decline rate
 * without the argument behind it tells a reader which rule to distrust but
 * never why.
 */
export const printStandardsHealth = ({ health }: Params): void => {
	const { rules, totals } = health;
	const rows = rules.flatMap((rule) => ruleRows({ rule }));
	const attempted = sum({ rules, of: (rule) => rule.attempted });
	const advice = sum({ rules, of: (rule) => rule.adviceApplied + rule.adviceDeclined });
	const totalsRow = {
		cells: [
			`${totals.rules} rule(s)`,
			`${totals.checked} by code, ${totals.judgment} by judgment`,
			count({ value: attempted }),
			count({ value: sum({ rules, of: (rule) => rule.resolved }) }),
			count({ value: sum({ rules, of: (rule) => rule.declined }) }),
			count({ value: sum({ rules, of: (rule) => rule.untracked }) }),
			rate({ part: sum({ rules, of: (rule) => rule.declined }), total: attempted }),
			count({ value: advice }),
			rate({ part: sum({ rules, of: (rule) => rule.adviceDeclined }), total: advice }),
		],
		emphasis: bold,
	};

	for (const line of renderTable({
		headers: ['rule', 'checked by', 'sites', 'resolved', 'declined', 'untracked', 'declined %', 'advice', 'advice declined %'],
		rows: [...rows, totalsRow],
	})) {
		console.log(line);
	}

	console.log('');
	console.log(dim('sites: blocking findings a refactor run worked and re-checked. advice: advisory and agent-review findings, as the agent reported them.'));
};
