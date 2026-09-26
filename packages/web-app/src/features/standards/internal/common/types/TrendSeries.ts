/**
 * Two count lines reduced to SVG path data in a 0–1 unit box, with the labels
 * that say what was plotted.
 *
 * A drawing rather than a measurement: the coordinates are normalized so a
 * chart can scale them to any size with a `viewBox`, and nothing here can be
 * read back as a finding count except `peak`.
 */
export interface TrendSeries {
	/** SVG path data for the blocking line and the total line, in a 0–1 unit box. */
	blocking: string;
	total: string;
	/** Axis labels: the first and last timestamps, and the highest count plotted. */
	from: string;
	to: string;
	peak: number;
}
