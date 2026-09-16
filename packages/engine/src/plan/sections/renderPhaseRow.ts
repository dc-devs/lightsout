import { encodeMarkdownTableCell } from '#src/plan/common/rewriting/encodeMarkdownTableCell.ts';
import type { PhaseDeclaration } from '#src/plan/common/types/PhaseDeclaration.ts';

interface Params {
	declaration: PhaseDeclaration;
	lossless?: boolean;
}

/** One authored field as a table cell: trimmed, its pipes escaped so a cell cannot split its own row, and its line breaks folded so a row stays one line. */
const toCell = ({ text }: { text: string }) => text.trim().replaceAll('|', '\\|').replace(/\r?\n/g, '<br>');

/**
 * One `## Phases` table row, rendered from one phase record.
 *
 * The exact inverse of the table half of `parsePhaseDeclarations`: the number,
 * the phase filename in a backtick span, the scope, the created count and the
 * touched count, so what is rendered here reads back as the record it came from.
 *
 * A count the record does not state renders as an empty cell — the shape that
 * parser already reads as "missing or not an integer", so the consistency check
 * can still report it. The literal text of an absent value must never reach a
 * cell, which is what an unguarded interpolation would put there.
 */
export const renderPhaseRow = ({ declaration, lossless = false }: Params): string => {
	const cells = [
		String(declaration.number),
		`\`${lossless ? encodeMarkdownTableCell({ text: declaration.file }) : declaration.file}\``,
		lossless ? encodeMarkdownTableCell({ text: declaration.scope }) : toCell({ text: declaration.scope }),
		declaration.createdCount === undefined ? '' : String(declaration.createdCount),
		declaration.touchedCount === undefined ? '' : String(declaration.touchedCount),
	];

	return `| ${cells.join(' | ')} |`;
};
