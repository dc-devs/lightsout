import { planSentinelTokens } from '#src/plan/common/constants/planSentinelTokens.ts';
import { planTextEncodingMarker } from '#src/plan/common/constants/planTextEncodingMarker.ts';
import { decodeMarkdownText } from '#src/plan/common/parsing/decodeMarkdownText.ts';
import { maskPlanCodeFences } from '#src/plan/common/parsing/maskPlanCodeFences.ts';
import { parseMarkdownTableCells } from '#src/plan/common/parsing/parseMarkdownTableCells.ts';
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
}

/** One `### Phase <n> — ` block's contents, keyed by the filename its header names. */
interface PhaseBlock {
	file: string;
	creates: string[];
	exports: string[];
	scripts: string[];
	fileBudget?: number;
}

/** A table cell's integer, or undefined when the cell is missing, empty or not an integer — the shape the consistency check reports. */
const integerFrom = ({ cell }: { cell: string | undefined }) => (/^\d+$/.test(cell?.trim() ?? '') ? Number(cell?.trim()) : undefined);

/** The `.md` filename a cell names, from its backtick span or its bare text. */
const fileFrom = ({ cell, lossless }: { cell: string | undefined; lossless: boolean }) => {
	const candidate =
		getCodeSpans({ line: cell ?? '', decode: lossless })[0] ?? (lossless ? decodeMarkdownText({ text: cell?.trim() ?? '' }) : (cell?.trim() ?? ''));

	return (lossless ? candidate.trimEnd() : candidate).endsWith('.md') ? candidate : undefined;
};

/** The bullet line carrying `- **<label>:**`, whatever its casing. */
const bulletLine = ({ lines, label }: { lines: string[]; label: string }) => {
	const marker = new RegExp(`^\\s*-\\s+\\*\\*${label}:\\*\\*`, 'i');

	return lines.find((line) => marker.test(line));
};

/** One bullet's declared values: its backticked spans, minus the sentinels the template defines as "nothing to declare". */
const bulletValues = ({ lines, label, lossless }: { lines: string[]; label: string; lossless: boolean }) => {
	const line = bulletLine({ lines, label });

	return line === undefined ? [] : getCodeSpans({ line, decode: lossless }).filter((span) => !planSentinelTokens.has(span));
};

/** The `## Phases` table's rows: every line whose first cell is an integer, so the header and separator rows drop out. */
const rowsFrom = ({ sectionLines }: { sectionLines: string[] }) => {
	const rows: PhaseRow[] = [];
	const lossless = sectionLines.includes(planTextEncodingMarker);

	for (const line of sectionLines) {
		if (!line.trim().startsWith('|')) {
			continue;
		}

		const cells = parseMarkdownTableCells({ line, decode: !lossless });
		const number = integerFrom({ cell: cells[0] });
		const file = fileFrom({ cell: cells[1], lossless });

		if (number === undefined || file === undefined) {
			continue;
		}

		rows.push({
			number,
			file,
			scope: lossless ? decodeMarkdownText({ text: cells[2] ?? '' }) : (cells[2] ?? ''),
			createdCount: integerFrom({ cell: cells[3] }),
			touchedCount: integerFrom({ cell: cells[4] }),
		});
	}

	return rows;
};

/** The integer of the optional `- **File budget:**` bullet, read past its label so the label's own digits can never be it. */
const fileBudgetFrom = ({ lines }: { lines: string[] }) => {
	const value = bulletLine({ lines, label: 'File budget' })?.replace(/^\s*-\s+\*\*[^*]+\*\*/, '');

	return integerFrom({ cell: /(\d+)/.exec(value ?? '')?.[1] });
};

/** The `## Phase Declarations` section's `### Phase <n> — ` blocks, in document order. */
const blocksFrom = ({ sectionLines }: { sectionLines: string[] }) => {
	const blocks: { file: string; lines: string[] }[] = [];
	const lossless = sectionLines.includes(planTextEncodingMarker);

	for (const line of sectionLines) {
		const header = /^###\s+Phase\s+\d+\s*[—–-]\s*`([^`]+)`/.exec(line);

		if (header) {
			blocks.push({ file: lossless ? decodeMarkdownText({ text: header[1].trim() }) : header[1].trim(), lines: [] });

			continue;
		}

		blocks.at(-1)?.lines.push(line);
	}

	const parsed: PhaseBlock[] = [];

	for (const { file, lines } of blocks) {
		parsed.push({
			file,
			creates: bulletValues({ lines, label: 'Creates', lossless }),
			exports: bulletValues({ lines, label: 'Exports', lossless }),
			scripts: bulletValues({ lines, label: 'Scripts', lossless }),
			fileBudget: fileBudgetFrom({ lines }),
		});
	}

	return parsed;
};

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
 * Rows are returned in table order.
 */
export const parsePhaseDeclarations = ({ plan }: Params): PhaseDeclaration[] => {
	const rows = rowsFrom({ sectionLines: maskPlanCodeFences({ lines: plan.sections.get('Phases') ?? [] }).lines });
	const blocks = blocksFrom({ sectionLines: maskPlanCodeFences({ lines: plan.sections.get('Phase Declarations') ?? [] }).lines });
	const claimed = new Set<string>();
	const declared = rows.map((row) => {
		const block = blocks.find(({ file }) => file === row.file);

		if (block) {
			claimed.add(block.file);
		}

		return { ...row, creates: block?.creates ?? [], exports: block?.exports ?? [], scripts: block?.scripts ?? [], fileBudget: block?.fileBudget };
	});
	const orphans = blocks
		.filter(({ file }) => !claimed.has(file))
		.map(({ file, creates, exports, scripts, fileBudget }) => ({ number: 0, file, scope: '', creates, exports, scripts, fileBudget }));

	return [...declared, ...orphans];
};
