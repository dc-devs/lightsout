import { dim } from '@/cli/common/terminal/dim';

interface Row {
	cells: string[];
	/** Emphasis applied to the whole row, e.g. bold for a totals line. */
	emphasis?: (text: string) => string;
	/** Per-cell repaint, given the plain text and the padded text. Returns the padded text to print. */
	paintCell?: (params: { text: string; padded: string; column: number }) => string;
	/** Draw a rule above this row. */
	ruleAbove?: boolean;
}

interface Params {
	headers: string[];
	rows: Row[];
}

/**
 * A box-drawn table: first column left-aligned, the rest right-aligned, columns
 * sized to their widest cell.
 *
 * Geometry is computed on the plain text and the paint is applied afterwards,
 * because an ANSI colour code is invisible on screen but counts toward
 * `String.length` — measuring painted text is what makes a coloured column
 * drift out of alignment.
 */
export const renderTable = ({ headers, rows }: Params): string[] => {
	const allCells = [headers, ...rows.map((row) => row.cells)];
	const widths = headers.map((_, column) => Math.max(...allCells.map((cells) => (cells[column] ?? '').length)) + 2);
	const rule = ({ left, mid, right }: { left: string; mid: string; right: string }) =>
		dim(`${left}${widths.map((width) => '─'.repeat(width)).join(mid)}${right}`);

	const renderRow = ({ cells, emphasis, paintCell }: Row) => {
		const rendered = cells.map((text, column) => {
			const width = widths[column] ?? 0;
			const padded = column === 0 ? ` ${text.padEnd(width - 1)}` : `${text.padStart(width - 1)} `;
			const painted = paintCell ? paintCell({ text, padded, column }) : padded;

			return emphasis && text !== '—' ? emphasis(painted) : painted;
		});

		return `${dim('│')}${rendered.join(dim('│'))}${dim('│')}`;
	};

	const lines = [rule({ left: '┌', mid: '┬', right: '┐' }), renderRow({ cells: headers })];

	// The header is always ruled off; `ruleAbove` only governs the rules
	// BETWEEN data rows, so a caller can run related rows together and still
	// separate a totals line.
	rows.forEach((row, index) => {
		if (index === 0 || row.ruleAbove !== false) {
			lines.push(rule({ left: '├', mid: '┼', right: '┤' }));
		}

		lines.push(renderRow(row));
	});

	lines.push(rule({ left: '└', mid: '┴', right: '┘' }));

	return lines;
};
