import type { StandardsFinding } from '@lightsout/engine';

interface Params {
	/** The finding whose first file — its site — decides the label. */
	finding: StandardsFinding;
	/** How many leading path segments the label keeps. */
	depth: number;
}

/**
 * The folder label one finding reduces to.
 *
 * A finding names one or more files and the first is its site, so that one path
 * decides the label; a finding naming no file at all is placed at `.`.
 *
 * The final segment is dropped only when it looks like a file — a dot in it —
 * so a folder site reported by a structure rule keeps its last segment, and a
 * path shorter than `depth` is used whole. That is the convention the engine's
 * `buildDominantPathNote` already computes the single winner with.
 *
 * Shared because two consumers must place a finding identically: the breakdown
 * that writes a folder's label, and the findings table that has to decide which
 * rows sit under the label a reader clicked. A second copy could disagree, and
 * the table would then answer a folder with nothing.
 */
export const getFindingFolder = ({ finding, depth }: Params): string => {
	const site = finding.files[0]?.path;

	if (site === undefined) {
		return '.';
	}

	const segments = site.split('/');
	const withoutFile = segments[segments.length - 1].includes('.') ? segments.slice(0, -1) : segments;

	return withoutFile.slice(0, depth).join('/') || '.';
};
