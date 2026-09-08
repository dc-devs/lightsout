import type { DecisionRow } from '#src/contracts/index.ts';

interface Params {
	/** The merged rows, brainstorm first, in record order. */
	decisions: DecisionRow[];
}

/**
 * One authored field as a table cell: trimmed, its pipes escaped so a cell
 * cannot split its own row, and its line breaks folded so a row stays one line.
 * Everything else is written verbatim — the log is a record of what the human
 * settled, never a paraphrase of it.
 */
const toCell = ({ text }: { text: string }) => text.trim().replaceAll('|', '\\|').replace(/\r?\n/g, '<br>');

/**
 * The 1-based position of the last row carrying each question, keyed by that
 * question. Two rows answering one question are a decision and its revision,
 * and the reader has to be told which one binds without comparing question
 * strings by eye.
 */
const bindingRowNumbers = ({ decisions }: { decisions: DecisionRow[] }) => {
	const binding = new Map<string, number>();

	for (const [index, row] of decisions.entries()) {
		binding.set(row.question, index + 1);
	}

	return binding;
};

/** The Choice cell with the markers a reader needs to weigh the row: an unconfirmed choice, and a choice a later row replaced. */
const toChoiceCell = ({ row, number, binding }: { row: DecisionRow; number: number; binding: Map<string, number> }) => {
	const bindingNumber = binding.get(row.question);
	const markers = [
		row.assumption ? '(assumption)' : undefined,
		bindingNumber !== undefined && bindingNumber > number ? `(superseded by #${bindingNumber})` : undefined,
	];

	return [toCell({ text: row.choice }), ...markers.filter((marker) => marker !== undefined)].join(' ');
};

/**
 * The plan's `## Decision Log` section, rendered from the merged decision
 * record — heading line included, no trailing newline, because the section
 * rewriter owns how the section joins the file around it.
 *
 * Pure and synchronous on purpose: the structural lint re-renders this to decide
 * whether a plan file's log is stale, and a renderer that read a clock, a config
 * or the disk would make that check report a difference nobody made.
 */
export const renderDecisionLog = ({ decisions }: Params): string => {
	const note = "Composed by `lightsout plan sync-decisions` from this plan's saved decision records. Do not edit by hand.";
	const headerRow = '| # | Source | Decision / Question | Options Considered | Choice | Rationale |';
	const separatorRow = '|---|--------|---------------------|--------------------|--------|-----------|';
	const binding = bindingRowNumbers({ decisions });
	const rows = decisions.map((row, index) => {
		const cells = [
			String(index + 1),
			toCell({ text: row.source }),
			toCell({ text: row.question }),
			toCell({ text: row.options }),
			toChoiceCell({ row, number: index + 1, binding }),
			toCell({ text: row.rationale }),
		];

		return `| ${cells.join(' | ')} |`;
	});
	const body = rows.length === 0 ? 'No decisions recorded.' : [headerRow, separatorRow, ...rows].join('\n');

	return `## Decision Log\n\n${note}\n\n${body}`;
};
