import { wrapText } from '@/cli/common/formatting/wrapText';
import { bold } from '@/cli/common/terminal/bold';
import { dim } from '@/cli/common/terminal/dim';
import { terminalWidth } from '@/cli/common/terminal/terminalWidth';
import { yellow } from '@/cli/common/terminal/yellow';
import { type StandardsFinding, StandardsSeverity } from '@/contracts';

interface Params {
	findings: StandardsFinding[];
}

const rowIndent = '    ';

const locationOf = ({ file }: { file: StandardsFinding['files'][number] }) => {
	if (file.startLine === undefined) {
		return file.path;
	}

	const span = file.endLine !== undefined && file.endLine !== file.startLine ? `-${file.endLine}` : '';

	return `${file.path}:${file.startLine}${span}`;
};

const headingOf = ({ rule, severity, count }: { rule: string; severity: StandardsSeverity; count: number }) => {
	const blocking = severity === StandardsSeverity.Blocking;
	const icon = blocking ? yellow('⚠') : dim('ℹ');
	// `blocking` reads the same at any count, so only the advisory noun pluralizes.
	const noun = blocking ? 'blocking' : count === 1 ? 'advisory' : 'advisories';

	return `${icon} ${bold(rule)} ${dim('·')} ${dim(`${count} ${noun}`)}`;
};

/**
 * Print the findings grouped under one heading per rule.
 *
 * Grouping is what makes the output readable: a rule's rows line up so
 * their measurements can be compared at a glance, and the guidance — which is
 * the same for every finding a rule emits for the same reason — is stated
 * once beneath the rows it covers instead of repeating on each. Within a group
 * the rows are ordered by guidance, so a rule that reports two different
 * kinds of problem still explains each one next to its own rows.
 *
 * A finding at a single site prints as one aligned row. A finding spanning
 * several files lists its locations and puts the detail underneath, because
 * there is no single location to align such a row on.
 */
export const printFindingGroups = ({ findings }: Params): void => {
	const width = terminalWidth();
	// Widest a location column may grow before its row falls back to two lines.
	const locationColumnCap = 52;
	const detailIndent = '      ';
	// Keyed on severity as well as rule: `size` reports an oversized file as
	// work and an oversized function as advice, and one heading cannot honestly
	// count both. The heading's rule and severity come from the finding that
	// opened the group, so an empty group is not a case to answer.
	const groups = new Map<string, { rule: string; severity: StandardsSeverity; findings: StandardsFinding[] }>();

	for (const finding of findings) {
		const key = `${finding.severity}:${finding.rule}`;
		const group = groups.get(key) ?? { rule: finding.rule, severity: finding.severity, findings: [] };

		group.findings.push(finding);
		groups.set(key, group);
	}

	for (const { rule, severity, findings: group } of groups.values()) {
		console.log('');
		console.log(headingOf({ rule, severity, count: group.length }));

		// Only single-site findings occupy the aligned column, so only they set its width.
		const singleWidths = group.flatMap((finding) => (finding.files.length === 1 ? finding.files.map((file) => locationOf({ file }).length) : []));
		const column = Math.min(Math.max(0, ...singleWidths), locationColumnCap);
		const byGuidance = new Map<string, StandardsFinding[]>();

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
