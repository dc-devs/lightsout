import type { StandardsFinding } from '@lightsout/engine';
import type { FolderGroup } from '#src/features/standards/common/types/FolderGroup.ts';

interface Params {
	findings: StandardsFinding[];
	depth: number;
}

/**
 * The folder label one site path reduces to.
 *
 * The final segment is dropped only when it looks like a file — a dot in it —
 * so a folder site reported by a structure rule keeps its last segment, and a
 * path shorter than `depth` is used whole. That is the convention the engine's
 * `buildDominantPathNote` already computes the single winner with.
 */
const getFolder = ({ site, depth }: { site: string; depth: number }) => {
	const segments = site.split('/');
	const withoutFile = segments[segments.length - 1].includes('.') ? segments.slice(0, -1) : segments;

	return withoutFile.slice(0, depth).join('/') || '.';
};

/**
 * Findings bucketed by the folder their first file sits in, largest bucket
 * first.
 *
 * A finding names one or more files and the first is its site, so that one path
 * decides the bucket; a finding naming no file at all buckets under `.`. Ties
 * break on the folder name so the same findings always render in the same
 * order.
 *
 * @param findings - the findings to bucket, already filtered to whatever the page is showing
 * @param depth - how many leading path segments a folder label keeps; the breakdown offers three and four
 */
export const groupFindingsByFolder = ({ findings, depth }: Params): FolderGroup[] => {
	const byFolder = new Map<string, Map<string, number>>();

	for (const finding of findings) {
		const folder = finding.files.length === 0 ? '.' : getFolder({ site: finding.files[0].path, depth });
		const rules = byFolder.get(folder) ?? new Map<string, number>();

		rules.set(finding.rule, (rules.get(finding.rule) ?? 0) + 1);
		byFolder.set(folder, rules);
	}

	return [...byFolder]
		.map(([folder, rules]) => ({
			folder,
			count: [...rules.values()].reduce((total, count) => total + count, 0),
			rules: [...rules].map(([rule, count]) => ({ rule, count })).sort((first, second) => second.count - first.count || first.rule.localeCompare(second.rule)),
		}))
		.sort((first, second) => second.count - first.count || first.folder.localeCompare(second.folder));
};
