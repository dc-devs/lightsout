import { StandardsRule, type StandardsFinding } from '@/contracts';
import type { FunctionSite } from '@/standardsCheck/common/types/FunctionSite';
import { buildFinding } from '@/standardsCheck/common/utils/buildFinding';
import { buildSiteKey } from '@/standardsCheck/common/utils/buildSiteKey';

interface Params {
	/** Every measured function body across the checked files. */
	sites: FunctionSite[];
}

/**
 * Group measured function bodies by their normalized-token hash and report each
 * group of two or more as a duplicate.
 *
 * Two hash groups spanning the SAME file set become one finding listing both:
 * the identity is the paths, and a hash in the key would re-mint that identity
 * on any edit — the one thing a debt ledger and a gate cannot survive.
 *
 * Split out of `checkAstFindings` to leave that function sequencing its passes.
 * A module internal — its behaviour is pinned through the AST tier's own tests.
 */
export const groupDuplicateFunctions = ({ sites }: Params): StandardsFinding[] => {
	const byHash = new Map<string, FunctionSite[]>();

	for (const site of sites) {
		byHash.set(site.hash, [...(byHash.get(site.hash) ?? []), site]);
	}

	const bySite = new Map<string, { files: StandardsFinding['files']; groups: string[] }>();

	for (const group of byHash.values()) {
		if (group.length > 1) {
			const files = group.map((site) => ({ path: site.path, startLine: site.startLine, endLine: site.endLine }));
			const siteKey = buildSiteKey({ rule: StandardsRule.AstDuplicate, files });
			const entry = bySite.get(siteKey) ?? { files: [], groups: [] };

			bySite.set(siteKey, {
				files: [...entry.files, ...files],
				groups: [...entry.groups, `${group.map((site) => `'${site.name}'`).join(', ')} (${group[0]?.tokenCount} tokens)`],
			});
		}
	}

	return [...bySite.values()].map(({ files, groups }) =>
		buildFinding({
			rule: StandardsRule.AstDuplicate,
			files,
			detail: `${groups.join('; ')} have identical bodies after identifier normalization`,
			guidance: 'Renaming the identifiers did not make these different functions.',
		}),
	);
};
