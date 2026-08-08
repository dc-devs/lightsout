import { StandardsRule, StandardsSeverity, type StandardsFinding } from '@/contracts';
import type { FunctionSite } from '@/standardsCheck/common/types/FunctionSite';

interface Params {
	/** Every measured function body across the checked files. */
	sites: FunctionSite[];
}

/**
 * Group measured function bodies by their normalized-token hash and report each
 * group of two or more as a duplicate.
 *
 * Split out of `checkAstFindings` to leave that function sequencing its passes.
 * A module internal — its behaviour is pinned through the AST tier's own tests.
 */
export const groupDuplicateFunctions = ({ sites }: Params): StandardsFinding[] => {
	const byHash = new Map<string, FunctionSite[]>();

	for (const site of sites) {
		byHash.set(site.hash, [...(byHash.get(site.hash) ?? []), site]);
	}

	const findings: StandardsFinding[] = [];

	for (const [hash, group] of byHash) {
		if (group.length > 1) {
			findings.push({
				rule: StandardsRule.AstDuplicate,
				severity: StandardsSeverity.Finding,
				siteKey: `ast:${hash.slice(0, 12)}`,
				files: group.map((site) => ({ path: site.path, startLine: site.startLine, endLine: site.endLine })),
				detail: `${group.map((site) => `'${site.name}'`).join(', ')} have identical bodies after identifier normalization (${group[0]?.tokenCount} tokens)`,
				guidance: 'Renaming the identifiers did not make these different functions.',
			});
		}
	}

	return findings;
};
