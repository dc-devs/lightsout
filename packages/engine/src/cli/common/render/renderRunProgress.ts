import { formatCost } from '@lightsout/shared';
import { statusIcons } from '#src/cli/common/constants/statusIcons.ts';
import { dim } from '#src/cli/common/terminal/dim.ts';
import { paintStatus } from '#src/cli/common/terminal/paintStatus.ts';
import { formatClockDuration } from '#src/cli/common/utils/formatClockDuration.ts';
import { RunStatus } from '#src/contracts/index.ts';
import type { RunProgress, RunProgressRow } from '#src/views/index.ts';

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
const rowCells = ({ row }: { row: RunProgressRow }) => {
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
	progress: RunProgress;
}

/**
 * A run's progress block as lines: a title line, a rule, one row per step, a
 * closing rule, the totals, and what the run is doing now.
 *
 * Pure — data in, strings out — because this is the ONE rendering of the
 * block. The chat view and the terminal view are the same bytes, so the layout
 * can be held to the character without a run to look at.
 *
 * The rules span the widest row rather than the 46 columns the chosen sample
 * drew them at. That width follows from no column and could not survive a
 * longer step id, which would leave the rules narrower still than the rows they
 * bracket — read as a drawing error rather than a choice. It is the one
 * departure from the sample; every other line reproduces it character for
 * character.
 */
export const renderRunProgress = ({ progress }: Params): string[] => {
	const cells = progress.rows.map((row) => rowCells({ row }));
	const idWidth = Math.max(minimumWidths.id, ...cells.map((cell) => cell.id.length + 2));
	const outcomeWidth = Math.max(minimumWidths.outcome, ...cells.map((cell) => cell.outcome.length + 2));
	const durationWidth = Math.max(minimumWidths.duration, ...cells.map((cell) => cell.duration?.length ?? 0));
	const rowLines = cells.map((cell) => {
		const head = ` ${cell.glyph}  ${cell.id.padEnd(idWidth)}`;

		return cell.duration === undefined ? `${head}${emDash}` : `${head}${cell.outcome.padEnd(outcomeWidth)}${cell.duration.padStart(durationWidth)}`;
	});
	const cost = progress.costUsd === undefined ? '' : ` · ${formatCost({ usd: progress.costUsd })}`;
	const totalsLine = ` elapsed ${formatClockDuration({ ms: progress.elapsedMs })} · ${progress.changedFileCount} files${cost}`;
	const nowLine = progress.now === undefined ? undefined : ` now  ${progress.now}`;
	const ruleWidth = Math.max(
		...rowLines.map((line) => line.length),
		totalsLine.length,
		nowLine?.length ?? 0,
		// The title line is measured too, or a long title would overhang the rule
		// it is supposed to sit inside and its padding could go negative.
		progress.title.length + progress.shortId.length + 1,
	);
	const rule = dim('─'.repeat(ruleWidth));
	const titleLine = `${progress.title}${' '.repeat(Math.max(1, ruleWidth - progress.shortId.length - progress.title.length))}${progress.shortId}`;
	// Painted last, and only the glyph: the geometry above is already settled on
	// the plain text, and the glyph is the one cell whose colour says something
	// the words do not.
	const painted = cells.map((cell, index) => {
		const glyph = cell.status === undefined ? dim(cell.glyph) : paintStatus({ status: cell.status, text: cell.glyph });

		return rowLines[index].replace(cell.glyph, glyph);
	});

	return [titleLine, rule, ...painted, rule, totalsLine, ...(nowLine === undefined ? [] : [nowLine])];
};
