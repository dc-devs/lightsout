import { ScanSeverity, type ScanFinding } from '@/contracts';
import { renderTable } from '@/cli/common/render/renderTable';
import { bold } from '@/cli/common/terminal/bold';
import { dim } from '@/cli/common/terminal/dim';
import { green } from '@/cli/common/terminal/green';

interface Params {
	findings: ScanFinding[];
	/** Where the typed report was written, relative to the repo root. */
	reportPath: string;
}

const countOf = ({ findings, detector, severity }: { findings: ScanFinding[]; detector: string; severity: ScanSeverity }) =>
	findings.filter((finding) => finding.detector === detector && finding.severity === severity).length;

const cell = ({ count }: { count: number }) => (count === 0 ? '—' : `${count}`);

/**
 * The per-detector tally, as a table.
 *
 * Findings and advisories are separate columns rather than one total, because
 * they ask for different things: a finding is work, an advisory is guidance
 * someone has to judge in context. A repo carrying only advisories is clean,
 * and a single summed number would report it as indebted.
 */
export const printScanSummary = ({ findings, reportPath }: Params): void => {
	console.log('');

	if (findings.length === 0) {
		console.log(green('clean — no findings, no advisories'));
		console.log(dim(`report: ${reportPath}`));

		return;
	}

	const detectors = [...new Set(findings.map((finding) => finding.detector))];
	const rows = detectors.map((detector) => ({
		cells: [
			detector,
			cell({ count: countOf({ findings, detector, severity: ScanSeverity.Finding }) }),
			cell({ count: countOf({ findings, detector, severity: ScanSeverity.Advisory }) }),
		],
		ruleAbove: false,
	}));
	const totals = {
		cells: [
			'total',
			cell({ count: findings.filter((finding) => finding.severity === ScanSeverity.Finding).length }),
			cell({ count: findings.filter((finding) => finding.severity === ScanSeverity.Advisory).length }),
		],
		emphasis: bold,
	};

	for (const line of renderTable({ headers: ['detector', 'findings', 'advisories'], rows: [...rows, totals] })) {
		console.log(line);
	}

	console.log('');
	console.log(dim(`report: ${reportPath}`));
};
