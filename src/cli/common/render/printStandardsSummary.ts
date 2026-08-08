import { StandardsSeverity, type StandardsFinding } from '@/contracts';
import type { StandardsRuleListing } from '@/standardsCheck';
import { renderTable } from '@/cli/common/render/renderTable';
import { bold } from '@/cli/common/terminal/bold';
import { dim } from '@/cli/common/terminal/dim';
import { green } from '@/cli/common/terminal/green';

interface Params {
	findings: StandardsFinding[];
	/** Every rule with its one-line summary — the tally names rule ids, which say nothing on their own. */
	rules: StandardsRuleListing[];
	/** Where the typed report was written, relative to the repo root. */
	reportPath: string;
}

const countOf = ({ findings, rule, severity }: { findings: StandardsFinding[]; rule: string; severity: StandardsSeverity }) =>
	findings.filter((finding) => finding.rule === rule && finding.severity === severity).length;

const cell = ({ count }: { count: number }) => (count === 0 ? '—' : `${count}`);

/**
 * The per-rule tally, as a table.
 *
 * Blocking and advisory are separate columns rather than one total, because
 * they ask for different things: a blocking finding is work, an advisory is
 * guidance someone has to judge in context. A repo carrying only advisories is
 * clean, and a single summed number would report it as indebted.
 *
 * Each rule's summary sits dim beneath its own row, the same shape `--list`
 * uses: a tally of rule ids alone tells a reader how much they have without
 * telling them what any of it is.
 */
export const printStandardsSummary = ({ findings, rules, reportPath }: Params): void => {
	console.log('');

	if (findings.length === 0) {
		console.log(green('clean — nothing blocking, no advisories'));
		console.log(dim(`report: ${reportPath}`));

		return;
	}

	const summaryOf = ({ rule }: { rule: string }) => rules.find((listing) => listing.rule === rule)?.summary ?? '';
	const reported = [...new Set(findings.map((finding) => finding.rule))];
	const rows = reported.flatMap((rule) => [
		{
			cells: [
				rule,
				cell({ count: countOf({ findings, rule, severity: StandardsSeverity.Blocking }) }),
				cell({ count: countOf({ findings, rule, severity: StandardsSeverity.Advisory }) }),
			],
		},
		{
			cells: [summaryOf({ rule }), '', ''],
			ruleAbove: false,
			emphasis: dim,
		},
	]);
	const totals = {
		cells: [
			'total',
			cell({ count: findings.filter((finding) => finding.severity === StandardsSeverity.Blocking).length }),
			cell({ count: findings.filter((finding) => finding.severity === StandardsSeverity.Advisory).length }),
		],
		emphasis: bold,
	};

	for (const line of renderTable({ headers: ['rule', 'blocking', 'advisories'], rows: [...rows, totals] })) {
		console.log(line);
	}

	console.log('');
	console.log(dim(`report: ${reportPath}`));
};
