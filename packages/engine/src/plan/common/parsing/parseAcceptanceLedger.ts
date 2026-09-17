import type { LedgerRow } from '#src/contracts/index.ts';

interface Params {
	/** The lines under the `## Acceptance Tests` heading, or undefined when the section is absent. */
	sectionLines: string[] | undefined;
	/** The 1-based line number the section's first line sits at in the plan file. */
	firstLine: number;
}

/** The cells of a markdown table row, without the empty spans the leading and trailing pipes produce. */
const cellsOf = ({ line }: { line: string }) => {
	const cells = line.trim().split('|');

	if (cells[0].trim() === '') {
		cells.shift();
	}

	if (cells.length > 0 && cells[cells.length - 1].trim() === '') {
		cells.pop();
	}

	return cells.map((cell) => cell.trim());
};

/** The template's own header row and the `|---|` rule beneath it — structure rather than content, so neither is a row and neither is malformed. */
const isTableFurniture = ({ cells }: { cells: string[] }) => cells[0].toLowerCase() === 'criterion' || cells.every((cell) => /^:?-{3,}:?$/.test(cell));

/**
 * Read the `## Acceptance Tests` section of a plan file into rows.
 *
 * The section is a markdown table whose columns are Criterion, Test file, Test
 * name and Gate, in that order, with the test-file cell holding one backticked
 * span. A row carrying fewer than three non-empty cells, or a test-file cell
 * with no backticked span, is reported by its 1-based line rather than dropped:
 * a criterion the parser silently loses is a criterion nothing ever checks,
 * which is the exact failure the ledger exists to prevent.
 *
 * A blank gate cell means the repository's `test` gate — the ledger's common
 * case, so writing it out on every row is ceremony. Pure and reads nothing from
 * disk; the lint is what opens the files the rows name.
 */
export const parseAcceptanceLedger = ({ sectionLines, firstLine }: Params): { rows: LedgerRow[]; malformedLines: number[] } => {
	const rows: LedgerRow[] = [];
	const malformedLines: number[] = [];

	for (const [index, line] of (sectionLines ?? []).entries()) {
		if (!line.trim().startsWith('|')) {
			continue;
		}

		const cells = cellsOf({ line });

		if (cells.length === 0 || isTableFurniture({ cells })) {
			continue;
		}

		const testFile = /`([^`]+)`/.exec(cells[1] ?? '')?.[1].trim();

		if (cells.filter((cell) => cell !== '').length < 3 || testFile === undefined || testFile === '') {
			malformedLines.push(firstLine + index);

			continue;
		}

		rows.push({
			criterion: cells[0],
			testFile,
			testName: cells[2],
			gate: cells[3] === undefined || cells[3] === '' ? 'test' : cells[3],
			line: firstLine + index,
		});
	}

	return { rows, malformedLines };
};
