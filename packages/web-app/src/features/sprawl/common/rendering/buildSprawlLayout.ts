import { sprawlBarCount } from '#src/features/sprawl/common/constants/sprawlBarCount.ts';
import { sprawlFolderRowCount } from '#src/features/sprawl/common/constants/sprawlFolderRowCount.ts';
import type { SprawlDataset } from '#src/features/sprawl/common/contracts/SprawlDataset.ts';
import type { SprawlBar } from '#src/features/sprawl/common/types/SprawlBar.ts';
import type { SprawlFolderRow } from '#src/features/sprawl/common/types/SprawlFolderRow.ts';
import type { SprawlLaneState } from '#src/features/sprawl/common/types/SprawlLaneState.ts';
import type { SprawlLayout } from '#src/features/sprawl/common/types/SprawlLayout.ts';

interface Params {
	state: SprawlLaneState;
	maxLines: number;
	caps: SprawlDataset['caps'];
	width: number;
	height: number;
}

/** Bars take the top of the box and folder rows the rest — one split, stated once. */
const barShare = 0.7;

/** The gap after a folder square, as a fraction of that square's edge. */
const squareGap = 0.25;

/** Biggest first, ties broken by path so one state always draws in one order. */
const takeLargest = ({ entries, count }: { entries: [string, number][]; count: number }) =>
	[...entries].sort(([leftPath, left], [rightPath, right]) => right - left || leftPath.localeCompare(rightPath)).slice(0, count);

/** A folder row's height, and the edge of the squares sitting in it. */
const measureRow = ({ height }: { height: number }) => {
	const rowHeight = (height * (1 - barShare)) / sprawlFolderRowCount;
	// A square's edge as a fraction of its row's height — the rest is the space
	// that keeps two rows from touching.
	const squareShare = 0.6;

	return { rowHeight, size: rowHeight * squareShare };
};

const buildBars = ({ state, maxLines, caps, width, height }: Params) => {
	const barArea = height * barShare;
	const barWidth = width / sprawlBarCount;

	return takeLargest({ entries: [...state.files], count: sprawlBarCount }).map(([path, lines], index): SprawlBar => {
		const barHeight = maxLines === 0 ? 0 : (lines / maxLines) * barArea;

		return {
			path,
			x: index * barWidth,
			y: barArea - barHeight,
			width: barWidth,
			height: barHeight,
			overCap: lines > (path.endsWith('.tsx') ? caps.tsxFile : caps.file),
		};
	});
};

const buildFolderRows = ({ state, cap, height }: { state: SprawlLaneState; cap: number; height: number }) => {
	const { rowHeight, size } = measureRow({ height });

	return takeLargest({ entries: [...state.folders], count: sprawlFolderRowCount }).map(([path, entries], index): SprawlFolderRow => {
		const top = height * barShare + index * rowHeight + (rowHeight - size) / 2;

		return {
			path,
			y: top,
			entries,
			overCap: entries > cap,
			squares: Array.from({ length: entries }, (_unused, square) => ({ x: square * size * (1 + squareGap), y: top, size })),
		};
	});
};

/**
 * One lane at one frame, reduced to rectangles in the caller's unit box.
 *
 * Both renderers — the page's inline SVG and the README GIF — call this with
 * the same box, so a folder square is the same square in each and neither gets
 * to invent a size of its own.
 *
 * @param state - the lane's full tree at this frame, from `buildSprawlLaneStates`
 * @param maxLines - the tallest file across every frame of both lanes, from `getSprawlMaxLines`, so the cap line never moves and both lanes share one scale
 * @param caps - the standards pack's own caps, as the dataset read them
 * @param width - the unit box's width
 * @param height - the unit box's height
 */
export const buildSprawlLayout = ({ state, maxLines, caps, width, height }: Params): SprawlLayout => {
	const barArea = height * barShare;
	const { size } = measureRow({ height });
	const folderRows = buildFolderRows({ state, cap: caps.folderCensus, height });

	return {
		bars: buildBars({ state, maxLines, caps, width, height }),
		folderRows,
		capY: maxLines === 0 ? barArea : barArea - (caps.file / maxLines) * barArea,
		censusX: caps.folderCensus * size * (1 + squareGap),
		// The census line spans the folder strip, which starts at the topmost row
		// placed above. A history with no folders yet has no strip, and the line
		// collapses to nothing at the foot of the box.
		censusY: Math.min(...folderRows.map((row) => row.y), height),
	};
};
