import type { ActivityNode } from '#src/contracts/activity/ActivityNode.ts';

interface Params {
	nodes: ActivityNode[];
}

interface Span {
	startedAt: string;
	/** Absent whenever any given level is still unfinished. */
	endedAt?: string;
}

/**
 * The window every given level sits inside: the earliest start to the latest
 * end.
 *
 * A level with no end at all leaves the window open — a report that borrowed a
 * finished sibling's end time would report a plan as over while it was still
 * running.
 */
export const spanOfActivityNodes = ({ nodes }: Params): Span => {
	const byTime = (left: string, right: string) => Date.parse(left) - Date.parse(right);
	const starts = nodes.map((node) => node.startedAt).sort(byTime);
	const ends = nodes.flatMap((node) => (node.endedAt === undefined ? [] : [node.endedAt])).sort(byTime);

	return {
		// A record holding no level at all has no window. The placeholder is read
		// by nothing: with no end there is no wall time, and every other total of
		// an empty record is zero.
		startedAt: starts[0] ?? new Date(0).toISOString(),
		endedAt: ends.length === nodes.length ? ends[ends.length - 1] : undefined,
	};
};
