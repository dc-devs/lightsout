import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { StandardsRule, type StandardsFinding } from '@/contracts';
import type { FunctionSite } from '@/standardsCheck/common/types/FunctionSite';
import type { OversizedFunction } from '@/standardsCheck/common/types/OversizedFunction';
import type { StandardsPass } from '@/standardsCheck/common/types/StandardsPass';
import { buildFinding } from '@/standardsCheck/common/utils/buildFinding';
import { collectFunctionSites } from '@/standardsCheck/common/utils/collectFunctionSites';
import { getRuleSettings } from '@/standardsCheck/common/utils/getRuleSettings';
import { groupDuplicateFunctions } from '@/standardsCheck/common/utils/groupDuplicateFunctions';

/**
 * Tier 2 of the duplication ladder plus the size audit, one AST pass:
 * every function-like body is normalized (identifiers → ID, literals → LIT,
 * structure kept) and hashed — identical hashes across ≥2 sites are
 * systematic-rename duplicates that token-level cloning misses. The same
 * walk measures function/file line counts against the standards' numeric
 * tables, which reach the pass as the `size-file` and `size-function` rules'
 * own settings.
 *
 * Every oversized function in one file is ONE `size-function` finding — the
 * work is "open this file and extract", which does not become three jobs
 * because three functions in it are long.
 */
export const checkAstFindings: StandardsPass = async ({ cwd, source, states, compiler }) => {
	if (compiler === undefined) {
		return [];
	}

	const fileCaps = getRuleSettings({ states, rule: StandardsRule.SizeFile });
	const functionCaps = getRuleSettings({ states, rule: StandardsRule.SizeFunction });
	const { minBodyTokens } = getRuleSettings({ states, rule: StandardsRule.AstDuplicate });
	const findings: StandardsFinding[] = [];
	const sites: FunctionSite[] = [];
	const oversizedByFile = new Map<string, OversizedFunction[]>();

	for (const file of source) {
		const text = await readFile(join(cwd, file), 'utf8').catch(() => undefined);

		if (text === undefined) {
			continue;
		}

		const lineCount = text.split('\n').length;
		const fileCap = file.endsWith('.tsx') ? fileCaps.tsxFile : fileCaps.file;

		if (lineCount > fileCap && basename(file) !== 'index.ts') {
			findings.push(
				buildFinding({
					rule: StandardsRule.SizeFile,
					files: [{ path: file }],
					detail: `${lineCount} lines (cap ~${fileCap})`,
					guidance: 'Split the file, or graduate the concept it has grown into.',
				}),
			);
		}

		const walked = collectFunctionSites({ file, text, compiler, minBodyTokens, caps: functionCaps });

		sites.push(...walked.sites);

		if (walked.oversized.length > 0) {
			oversizedByFile.set(file, walked.oversized);
		}
	}

	for (const [file, oversized] of oversizedByFile) {
		findings.push(
			buildFinding({
				rule: StandardsRule.SizeFunction,
				files: oversized.map(({ startLine, endLine }) => ({ path: file, startLine, endLine })),
				detail: oversized.map(({ kind, name, lines, cap }) => `${kind} '${name}' is ${lines} lines (cap ~${cap})`).join('; '),
				guidance: 'Extract logic. Orchestration that only sequences step calls is exempt — judge before acting.',
			}),
		);
	}

	findings.push(...groupDuplicateFunctions({ sites }));

	return findings;
};
