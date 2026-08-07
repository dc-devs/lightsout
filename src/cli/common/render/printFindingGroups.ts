import { ScanSeverity, type ScanFinding } from '@/contracts';
import { wrapText } from '@/cli/common/formatting/wrapText';
import { bold } from '@/cli/common/terminal/bold';
import { dim } from '@/cli/common/terminal/dim';
import { terminalWidth } from '@/cli/common/terminal/terminalWidth';
import { yellow } from '@/cli/common/terminal/yellow';

interface Params {
	findings: ScanFinding[];
}

/** Widest a location column may grow before its row falls back to two lines. */
const locationColumnCap = 52;
const rowIndent = '    ';
const detailIndent = '      ';

const locationOf = ({ file }: { file: ScanFinding['files'][number] }) => {
	if (file.startLine === undefined) {
		return file.path;
	}

	const span = file.endLine !== undefined && file.endLine !== file.startLine ? `-${file.endLine}` : '';

	return `${file.path}:${file.startLine}${span}`;
};

const headingOf = ({ detector, severity, count }: { detector: string; severity: ScanSeverity; count: number }) => {
	const finding = severity === ScanSeverity.Finding;
	const icon = finding ? yellow('⚠') : dim('ℹ');
	const noun = finding ? (count === 1 ? 'finding' : 'findings') : count === 1 ? 'advisory' : 'advisories';

	return `${icon} ${bold(detector)} ${dim('·')} ${dim(`${count} ${noun}`)}`;
};

/**
 * Print the findings grouped under one heading per detector.
 *
 * Grouping is what makes the output readable: a detector's rows line up so
 * their measurements can be compared at a glance, and the guidance — which is
 * the same for every finding a detector emits for the same reason — is stated
 * once beneath the rows it covers instead of repeating on each. Within a group
 * the rows are ordered by guidance, so a detector that reports two different
 * kinds of problem still explains each one next to its own rows.
 *
 * A finding at a single site prints as one aligned row. A finding spanning
 * several files lists its locations and puts the detail underneath, because
 * there is no single location to align such a row on.
 */
export const printFindingGroups = ({ findings }: Params): void => {
	const width = terminalWidth();
	// Keyed on severity as well as detector: `size` reports an oversized file as
	// work and an oversized function as advice, and one heading cannot honestly
	// count both. The heading's detector and severity come from the finding that
	// opened the group, so an empty group is not a case to answer.
	const groups = new Map<string, { detector: string; severity: ScanSeverity; findings: ScanFinding[] }>();

	for (const finding of findings) {
		const key = `${finding.severity}:${finding.detector}`;
		const group = groups.get(key) ?? { detector: finding.detector, severity: finding.severity, findings: [] };

		group.findings.push(finding);
		groups.set(key, group);
	}

	for (const { detector, severity, findings: group } of groups.values()) {
		console.log('');
		console.log(headingOf({ detector, severity, count: group.length }));

		// Only single-site findings occupy the aligned column, so only they set its width.
		const singleWidths = group.flatMap((finding) => (finding.files.length === 1 ? finding.files.map((file) => locationOf({ file }).length) : []));
		const column = Math.min(Math.max(0, ...singleWidths), locationColumnCap);
		const byGuidance = new Map<string, ScanFinding[]>();

		for (const finding of group) {
			byGuidance.set(finding.guidance ?? '', [...(byGuidance.get(finding.guidance ?? '') ?? []), finding]);
		}

		for (const [guidance, partition] of byGuidance) {
			console.log('');

			for (const finding of partition) {
				const locations = finding.files.map((file) => locationOf({ file }));
				// Only a single-site finding has one location to align a row on; a
				// multi-site one has none, which is what `undefined` says here.
				const inline = locations.length === 1 ? locations[0] : undefined;

				if (inline !== undefined && inline.length <= column) {
					console.log(`${rowIndent}${inline.padEnd(column + 2)}${dim(finding.detail)}`);
					continue;
				}

				for (const location of locations) {
					console.log(`${rowIndent}${location}`);
				}

				for (const line of wrapText({ text: finding.detail, width, indent: detailIndent })) {
					console.log(dim(line));
				}
			}

			if (guidance !== '') {
				console.log('');

				for (const line of wrapText({ text: guidance, width, indent: rowIndent })) {
					console.log(dim(line));
				}
			}
		}
	}
};
