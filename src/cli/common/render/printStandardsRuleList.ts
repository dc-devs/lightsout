import { StandardsSeverity } from '@/contracts';
import type { StandardsRuleListing } from '@/standardsCheck';
import { renderTable } from '@/cli/common/render/renderTable';
import { bold } from '@/cli/common/terminal/bold';
import { dim } from '@/cli/common/terminal/dim';

const countOf = ({ rules, severity }: { rules: StandardsRuleListing[]; severity: StandardsSeverity }) =>
	rules.filter((rule) => rule.severity === severity).length;

/** 'file 250, tsxFile 300' — the rule's live numbers, so a retuned knob is visible without opening the config. */
const describeSettings = ({ settings }: { settings: Record<string, number> }) =>
	Object.entries(settings)
		.map(([name, value]) => `${name} ${value}`)
		.join(', ');

interface Params {
	rules: StandardsRuleListing[];
}

/**
 * The enforcement ledger, as a table.
 *
 * Rows carry the rule, the state it runs at in this repo, and the standards
 * doc it enforces — the doc column is what makes the output actionable rather
 * than a list of ids. A row the repo's config set is marked, because "this is
 * our policy" and "this is the default" are different answers to the question
 * the reader is asking. Each rule's summary sits beneath its own row, so the
 * reader learns what a rule catches without leaving the table.
 */
export const printStandardsRuleList = ({ rules }: Params): void => {
	const rows = rules.flatMap((rule) => {
		const settings = describeSettings({ settings: rule.settings });

		return [
			{
				// The severity IS the state label — nothing to translate, which is the point of naming it `blocking`.
				cells: [rule.rule, rule.fromConfig ? `${rule.severity} (config)` : rule.severity, rule.doc],
			},
			{
				cells: [settings === '' ? rule.summary : `${rule.summary} — ${settings}`, '', ''],
				ruleAbove: false,
				emphasis: dim,
			},
		];
	});
	const totals = {
		cells: [
			`${rules.length} rule(s)`,
			`${countOf({ rules, severity: StandardsSeverity.Blocking })} blocking`,
			`${countOf({ rules, severity: StandardsSeverity.Advisory })} advisory, ${countOf({ rules, severity: StandardsSeverity.Off })} off`,
		],
		emphasis: bold,
	};

	for (const line of renderTable({ headers: ['rule', 'state', 'standards doc'], rows: [...rows, totals] })) {
		console.log(line);
	}
};
