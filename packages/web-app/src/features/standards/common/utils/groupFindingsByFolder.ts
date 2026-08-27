import type { StandardsFinding } from '@lightsout/engine';
import type { FolderGroup } from '#src/features/standards/common/types/FolderGroup.ts';
import { getFindingFolder } from '#src/features/standards/common/utils/getFindingFolder.ts';

interface Params {
	findings: StandardsFinding[];
	depth: number;
}

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
		const folder = getFindingFolder({ finding, depth });
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
