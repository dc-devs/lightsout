import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Detector, MemoryStore } from '@jscpd/core';
import { Tokenizer } from '@jscpd/tokenizer';
import { StandardsRule, type StandardsFinding } from '@/contracts';
import { blankImportSpans } from '@/standardsCheck/blankImportSpans';
import type { StandardsPass } from '@/standardsCheck/common/types/StandardsPass';
import { buildFinding } from '@/standardsCheck/common/utils/buildFinding';
import { buildSiteKey } from '@/standardsCheck/common/utils/buildSiteKey';
import { getRuleSettings } from '@/standardsCheck/common/utils/getRuleSettings';

const formatOf = (path: string) => (/\.(m|c)?tsx?$/.test(path) ? 'typescript' : 'javascript');

/**
 * Tier 1 of the duplication ladder: jscpd token-span clone detection —
 * catches copy-paste and renamed functions with identical bodies, including
 * sub-function spans the AST tier can't see. Misses systematic identifier
 * renames (that's tier 2's job).
 *
 * Every span shared by the same pair of files is ONE finding: the identity is
 * the paths, so a second copy-paste between two files it already flags is more
 * evidence for that finding rather than a separate one to accept or resolve.
 */
export const checkClones: StandardsPass = async ({ cwd, source, states }) => {
	const { minTokens } = getRuleSettings({ states, rule: StandardsRule.Clone });
	const detector = new Detector(new Tokenizer(), new MemoryStore(), [], { minTokens, minLines: 5 });
	const bySite = new Map<string, { files: StandardsFinding['files']; longest: number }>();

	for (const file of source) {
		const text = await readFile(join(cwd, file), 'utf8').catch(() => undefined);

		if (text === undefined) {
			continue;
		}

		// Imports are non-deduplicable by construction — blank them (newline-
		// preserving) so shared import lists never token-match as clones.
		const clones = await detector.detect(file, blankImportSpans({ text }), formatOf(file));

		for (const clone of clones) {
			const a = clone.duplicationA;
			const b = clone.duplicationB;
			const spans = [
				{ path: b.sourceId, startLine: b.start.line, endLine: b.end.line },
				{ path: a.sourceId, startLine: a.start.line, endLine: a.end.line },
			];
			const siteKey = buildSiteKey({ rule: StandardsRule.Clone, files: spans });
			const site = bySite.get(siteKey) ?? { files: [], longest: 0 };

			bySite.set(siteKey, {
				files: [...site.files, ...spans],
				longest: Math.max(site.longest, a.end.line - a.start.line + 1),
			});
		}
	}

	return [...bySite.values()].map(({ files, longest }) =>
		buildFinding({
			rule: StandardsRule.Clone,
			files,
			detail: `${files.length / 2} duplicated span(s), the longest ${longest} lines`,
			guidance: 'Copy-paste at the token level. Extract the shared span, or justify why the copies must diverge.',
		}),
	);
};
