import type { SprawlBar } from '#src/features/sprawl/common/types/SprawlBar.ts';
import type { SprawlFolderRow } from '#src/features/sprawl/common/types/SprawlFolderRow.ts';

/**
 * One lane at one frame, reduced to rectangles.
 *
 * A drawing rather than a measurement: the page and the GIF renderer both take
 * their geometry from here, so the two can never disagree about where a bar
 * sits or how big a folder square is.
 */
export interface SprawlLayout {
	bars: SprawlBar[];
	folderRows: SprawlFolderRow[];
	/** Where the file cap sits on the bar scale. */
	capY: number;
	/** Where the folder-census cap sits across a folder row. */
	censusX: number;
	/** The top of the folder strip, where the census line starts; the foot of the box when there are no folders yet. */
	censusY: number;
}
