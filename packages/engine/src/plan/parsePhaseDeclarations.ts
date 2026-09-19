import { planSentinelTokens } from '#src/plan/common/constants/planSentinelTokens.ts';
import type { ParsedPlan } from '#src/plan/common/types/ParsedPlan.ts';
import type { PhaseDeclaration } from '#src/plan/common/types/PhaseDeclaration.ts';
import { getCodeSpans } from '#src/plan/common/utils/getCodeSpans.ts';

interface Params {
	/** The parsed overview file. */
	plan: ParsedPlan;
}

/** One `## Phases` table row, before its declaration block is joined on. */
interface PhaseRow {
	number: number;
	file: string;
	scope: string;
	createdCount?: number;
	touchedCount?: number;
	rowLine: number;
}

/** One `### Phase <n> — ` block's contents, keyed by the filename its header names. */
interface PhaseBlock {
	file: string;
	creates: string[];
	exports: string[];
	scripts: string[];
	fileBudget?: number;
	blockRange: { start: number; end: number };
}

/** A table cell's integer, or undefined when the cell is missing, empty or not an integer — the shape the consistency check reports. */
const integerFrom = ({ cell }: { cell: string | undefined }) => (/^\d+$/.test(cell?.trim() ?? '') ? Number(cell?.trim()) : undefined);

/** The `.md` filename a cell names, from its backtick span or its bare text. */
const fileFrom = ({ cell }: { cell: string | undefined }) => {
	const candidate = getCodeSpans({ line: cell ?? '' })[0] ?? cell?.trim() ?? '';

	return candidate.endsWith('.md') ? candidate : undefined;
};

/** The bullet line carrying `- **<label>:**`, whatever its casing. */
const bulletLine = ({ lines, label }: { lines: string[]; label: string }) => {
	const marker = new RegExp(`^\\s*-\\s+\\*\\*${label}:\\*\\*`, 'i');

	return lines.find((line) => marker.test(line));
};

/** One bullet's declared values: its backticked spans, minus the sentinels the template defines as "nothing to declare". */
const bulletValues = ({ lines, label }: { lines: string[]; label: string }) => {
	const line = bulletLine({ lines, label });

	return line === undefined ? [] : getCodeSpans({ line }).filter((span) => !planSentinelTokens.has(span));
};

/**
 * The `## Phases` table's rows: every line whose first cell is an integer, so
 * the header and separator rows drop out. Each row carries the absolute line it
 * sits at, counted from `firstLine` — the section's own first line — because the
 * span a row covers is read from the overview rather than from the section.
 */
const rowsFrom = ({ sectionLines, firstLine }: { sectionLines: string[] | undefined; firstLine: number }) => {
	const rows: PhaseRow[] = [];

	for (const [index, line] of (sectionLines ?? []).entries()) {
		if (!line.trim().startsWith('|')) {
			continue;
		}

		const cells = line.split('|').slice(1, -1);
		const number = integerFrom({ cell: cells[0] });
		const file = fileFrom({ cell: cells[1] });

		if (number === undefined || file === undefined) {
			continue;
		}

		rows.push({
			number,
			file,
			scope: cells[2]?.trim() ?? '',
			createdCount: integerFrom({ cell: cells[3] }),
			touchedCount: integerFrom({ cell: cells[4] }),
			rowLine: firstLine + index,
		});
	}

	return rows;
};

/** The integer of the optional `- **File budget:**` bullet, read past its label so the label's own digits can never be it. */
const fileBudgetFrom = ({ lines }: { lines: string[] }) => {
	const value = bulletLine({ lines, label: 'File budget' })?.replace(/^\s*-\s+\*\*[^*]+\*\*/, '');

	return integerFrom({ cell: /(\d+)/.exec(value ?? '')?.[1] });
};

/**
 * The `## Phase Declarations` section's `### Phase <n> — ` blocks, in document
 * order, each carrying the absolute inclusive range it covers: its header line
 * through the last line before the next header, or through the section's own
 * last line for the final block.
 */
const blocksFrom = ({ sectionLines, firstLine }: { sectionLines: string[] | undefined; firstLine: number }) => {
	const lines = sectionLines ?? [];
	const blocks: { file: string; start: number; lines: string[] }[] = [];

	for (const [index, line] of lines.entries()) {
		const header = /^###\s+Phase\s+\d+\s*[—–-]\s*`([^`]+)`/.exec(line);

		if (header) {
			blocks.push({ file: header[1].trim(), start: firstLine + index, lines: [] });

			continue;
		}

		blocks.at(-1)?.lines.push(line);
	}

	const sectionEnd = firstLine + lines.length - 1;
	const parsed: PhaseBlock[] = [];

	for (const [index, { file, start, lines: blockLines }] of blocks.entries()) {
		parsed.push({
			file,
			creates: bulletValues({ lines: blockLines, label: 'Creates' }),
			exports: bulletValues({ lines: blockLines, label: 'Exports' }),
			scripts: bulletValues({ lines: blockLines, label: 'Scripts' }),
			fileBudget: fileBudgetFrom({ lines: blockLines }),
			blockRange: { start, end: (blocks[index + 1]?.start ?? sectionEnd + 1) - 1 },
		});
	}

	return parsed;
};

/** A section's 1-based first line — the line below its heading, which is where its own reader's indices are counted from. */
const firstLineOf = ({ plan, heading }: { plan: ParsedPlan; heading: string }) => (plan.sectionRanges.get(heading)?.start ?? 0) + 1;

/**
 * Parse the overview's `## Phases` table and `## Phase Declarations` section
 * into one row per phase, joined on the phase file's basename.
 *
 * A `## Phases` row is `| <n> | ` + a backticked phase filename + ` | <scope> |
 * <createdCount> | <touchedCount> |`; the header and separator rows are skipped
 * by requiring an integer in the first cell.
 *
 * A declaration block header is `### Phase <n> — ` + a backticked phase
 * filename, both parts required. The **join key is that filename**, not the
 * number: a hand-edit during Converge is likelier to renumber a phase than to
 * rename its file, and joining on the number would silently pair a block with
 * the wrong phase.
 *
 * Each block carries `- **Creates:**`, `- **Exports:**` and `- **Scripts:**`
 * bullets whose values are the backticked spans on that line, or empty when the
 * line reads `none`, plus an optional `- **File budget:**` bullet holding one
 * integer.
 *
 * Malformed input is preserved, never repaired or dropped — each of these is a
 * hand-edit the consistency check exists to catch:
 * - a count cell missing or non-integer parses as `undefined`;
 * - a declaration block matching no table row is returned with `number: 0` and
 *   its filename, so an orphan block can be reported;
 * - a table row with no block parses with empty `creates`, `exports` and
 *   `scripts`, which is legitimate for a phase that hands nothing forward.
 *
 * Each declaration also states where its two spans sit in the overview —
 * `rowLine` for the table row and `blockRange` for the declaration block — which
 * is what lets the grading fingerprint credit that text to this phase rather
 * than to the overview every phase shares. A mismatch is stated rather than
 * repaired here too: an orphan block carries a range and no row line, and a row
 * with no block carries a line and no range.
 *
 * Rows are returned in table order.
 */
export const parsePhaseDeclarations = ({ plan }: Params): PhaseDeclaration[] => {
	const rows = rowsFrom({ sectionLines: plan.sections.get('Phases'), firstLine: firstLineOf({ plan, heading: 'Phases' }) });
	const blocks = blocksFrom({ sectionLines: plan.sections.get('Phase Declarations'), firstLine: firstLineOf({ plan, heading: 'Phase Declarations' }) });
	const claimed = new Set<string>();
	const declared = rows.map((row) => {
		const block = blocks.find(({ file }) => file === row.file);

		if (block) {
			claimed.add(block.file);
		}

		return {
			...row,
			creates: block?.creates ?? [],
			exports: block?.exports ?? [],
			scripts: block?.scripts ?? [],
			fileBudget: block?.fileBudget,
			...(block === undefined ? {} : { blockRange: block.blockRange }),
		};
	});
	const orphans = blocks
		.filter(({ file }) => !claimed.has(file))
		.map(({ file, creates, exports, scripts, fileBudget, blockRange }) => ({ number: 0, file, scope: '', creates, exports, scripts, fileBudget, blockRange }));

	return [...declared, ...orphans];
};
