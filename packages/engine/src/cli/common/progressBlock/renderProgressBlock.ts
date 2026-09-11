import { statusIcons } from '#src/cli/common/constants/statusIcons.ts';
import { dim } from '#src/cli/common/terminal/dim.ts';
import { paintStatus } from '#src/cli/common/terminal/paintStatus.ts';
import { formatClockDuration } from '#src/cli/common/utils/formatClockDuration.ts';
import { RunStatus } from '#src/contracts/index.ts';
import type { RunProgressRow } from '#src/views/index.ts';

/** One step row as the block draws it: which step, how it ended, how often it ran, and for how long. */
type BlockRow = Pick<RunProgressRow, 'id' | 'status' | 'attempts' | 'durationMs'>;

/** What a row with no outcome to state shows instead of one. */
const emDash = '—';

/** The glyph a step the run has not reached carries — this layout's own, quieter than the hollow circle a status table uses. */
const notReachedGlyph = '·';

/**
 * The sample block's own column widths, which are the floors every narrower
 * run reproduces exactly: 4 + 21 + 17 + 7 = the 49-column row the layout was
 * chosen as. A longer step id widens that one column rather than breaking the
 * alignment.
 */
const minimumWidths = { id: 21, outcome: 17, duration: 7 };

/** Where this layout's glyphs differ from the status table's: a running step points forward, and one not yet started is a bullet. */
const layoutGlyphs: Partial<Record<RunStatus, string>> = {
	[RunStatus.Running]: '▶',
	[RunStatus.Pending]: notReachedGlyph,
};

const rowGlyph = ({ status }: { status: RunStatus | undefined }) => (status === undefined ? notReachedGlyph : (layoutGlyphs[status] ?? statusIcons[status]));

/**
 * One row's plain cells, un-padded — the geometry is measured on these, because
 * an ANSI colour code counts toward `String.length` and occupies no column.
 *
 * A row the run has not reached ends at the em dash: no outcome to pad out and
 * no clock to show. Both ways a run can have one read the same, because they
 * mean the same thing to a reader — an implement run has no record at all for a
 * step it has not started, while a phased coordinator seeds a `pending` record
 * for every phase before anything runs.
 */
const rowCells = ({ row }: { row: BlockRow }) => {
	const glyph = rowGlyph({ status: row.status });

	if (row.status === undefined || row.status === RunStatus.Pending) {
		// The status is dropped, not carried: a not-yet-reached row is painted and
		// cut the same way whether the record says `pending` or there is no record.
		return { glyph, status: undefined, id: row.id, outcome: emDash, duration: undefined };
	}

	const outcome = row.attempts > 1 ? `${row.status} (x${row.attempts})` : row.status;

	return { glyph, status: row.status, id: row.id, outcome, duration: formatClockDuration({ ms: row.durationMs }) };
};

interface Params {
	/** Left of the title line. */
	title: string;
	/** Right-aligned on the title line, ending flush with the rule. */
	tag: string;
	rows: BlockRow[];
	/** Complete lines drawn between the rows and the closing rule. */
	diagnostics: string[];
	/** The totals text, without its leading space. */
	totals: string;
	/** The now text, without its label. When undefined, no now line is drawn. */
	now: string | undefined;
}

/**
 * A progress block as lines: a title line with its tag, a rule, one row per
 * step, any diagnostic lines, a closing rule, the totals, and what is happening
 * now.
 *
 * Pure — data in, strings out — because this is the ONE layout every progress
 * block shares: a run's, a plan's planning steps, a ship's. The chat view and
 * the terminal view are the same bytes, so the layout can be held to the
 * character without anything running to look at.
 *
 * The rules span the widest line rather than a fixed width, so a longer step id
 * or diagnostic drags them out with it instead of overhanging them.
 */
export const renderProgressBlock = ({ title, tag, rows, diagnostics, totals, now }: Params): string[] => {
	const cells = rows.map((row) => rowCells({ row }));
	const idWidth = Math.max(minimumWidths.id, ...cells.map((cell) => cell.id.length + 2));
	const outcomeWidth = Math.max(minimumWidths.outcome, ...cells.map((cell) => cell.outcome.length + 2));
	const durationWidth = Math.max(minimumWidths.duration, ...cells.map((cell) => cell.duration?.length ?? 0));
	const rowLines = cells.map((cell) => {
		const head = ` ${cell.glyph}  ${cell.id.padEnd(idWidth)}`;

		return cell.duration === undefined ? `${head}${emDash}` : `${head}${cell.outcome.padEnd(outcomeWidth)}${cell.duration.padStart(durationWidth)}`;
	});
	const totalsLine = ` ${totals}`;
	const nowLine = now === undefined ? undefined : ` now  ${now}`;
	const ruleWidth = Math.max(
		...rowLines.map((line) => line.length),
		...diagnostics.map((line) => line.length),
		totalsLine.length,
		nowLine?.length ?? 0,
		// The title line is measured too, or a long title would overhang the rule
		// it is supposed to sit inside and its padding could go negative.
		title.length + tag.length + 1,
	);
	const rule = dim('─'.repeat(ruleWidth));
	const titleLine = `${title}${' '.repeat(Math.max(1, ruleWidth - tag.length - title.length))}${tag}`;
	// Painted last, and only the glyph: the geometry above is already settled on
	// the plain text, and the glyph is the one cell whose colour says something
	// the words do not.
	const painted = cells.map((cell, index) => {
		const glyph = cell.status === undefined ? dim(cell.glyph) : paintStatus({ status: cell.status, text: cell.glyph });

		return rowLines[index].replace(cell.glyph, glyph);
	});

	return [titleLine, rule, ...painted, ...diagnostics, rule, totalsLine, ...(nowLine === undefined ? [] : [nowLine])];
};
