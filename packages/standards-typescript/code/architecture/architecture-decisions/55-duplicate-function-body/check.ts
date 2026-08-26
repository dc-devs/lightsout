import type { RawStandardsFinding, StandardsCheckModule, SyntaxTreeInput } from '@lightsout/standards-contracts';
import { buildRawFinding } from '../../../../common/findings/buildRawFinding.ts';
import { getSiteGroupKey } from '../../../../common/findings/getSiteGroupKey.ts';
import { collectFunctionNodes } from '../../../../common/parsing/collectFunctionNodes.ts';
import { isDelegationForwardBody } from '../../../../common/parsing/isDelegationForwardBody.ts';
import { getOwningPack } from '../../../../common/paths/getOwningPack.ts';
import { normalizeFunctionTokens } from './normalizeFunctionTokens.ts';

/** One measured function body: where it sits, and what the finding calls it. */
interface BodySite {
	name: string;
	path: string;
	startLine: number;
	endLine: number;
	tokenCount: number;
}

/**
 * Every body big enough to be a duplicate candidate, grouped by its normalized
 * token stream. The stream is its own identity — hashing it would buy a shorter
 * key and a collision the rule could never explain to the person reading it.
 *
 * Grouped within one shipped thing rather than across the repo. A standards
 * package installs on machines where the rest of this repo is absent, so a
 * function it shares with the engine cannot be deduplicated — whichever copy
 * went, one side would be left importing what is not there.
 */
const groupByBody = ({ input, minBodyTokens }: { input: SyntaxTreeInput; minBodyTokens: number }) => {
	const byBody = new Map<string, BodySite[]>();

	for (const [path, tree] of input.trees) {
		for (const { name, startLine, endLine, body } of collectFunctionNodes({ sourceFile: tree, compiler: input.compiler })) {
			const tokens = normalizeFunctionTokens({ node: body, compiler: input.compiler });

			// A one-line forward to a `this`-held collaborator is the shape the
			// composition-over-inheritance rule mandates — never a duplicate
			// candidate, however many classes hold the same collaborator.
			if (tokens.length >= minBodyTokens && !isDelegationForwardBody({ body, compiler: input.compiler })) {
				const key = `${getOwningPack({ path, standardsPacks: input.standardsPacks })}:${tokens.join(',')}`;

				byBody.set(key, [...(byBody.get(key) ?? []), { name, path, startLine, endLine, tokenCount: tokens.length }]);
			}
		}
	}

	return byBody;
};

/**
 * The duplicate groups merged by the files they span. Two groups over the SAME
 * file set become one finding naming both: the identity is the paths, and a
 * body in the key would re-mint that identity on any edit — the one thing a
 * debt ledger and a gate cannot survive.
 */
const mergeByFileSet = ({ groups }: { groups: BodySite[][] }) => {
	const bySite = new Map<string, { files: RawStandardsFinding['files']; described: string[] }>();

	for (const group of groups) {
		if (group.length > 1) {
			const [first] = group;
			const files = group.map(({ path, startLine, endLine }) => ({ path, startLine, endLine }));
			const key = getSiteGroupKey({ files });
			const entry = bySite.get(key) ?? { files: [], described: [] };

			bySite.set(key, {
				files: [...entry.files, ...files],
				described: [...entry.described, `${group.map(({ name }) => `'${name}'`).join(', ')} (${first.tokenCount} tokens)`],
			});
		}
	}

	return bySite;
};

export const check: StandardsCheckModule = {
	inputKind: 'syntax-tree',
	// Tier 2 of the duplication ladder: two bodies that match once their names
	// and literals are set aside are the same function written twice under new
	// names, which comparing the text side by side cannot see.
	run: ({ input, settings }): RawStandardsFinding[] => {
		const groups = input.kind === 'syntax-tree' ? [...groupByBody({ input, minBodyTokens: settings.minBodyTokens }).values()] : [];

		return [...mergeByFileSet({ groups }).values()].map(({ files, described }) =>
			buildRawFinding({
				rule: 'duplicate-function-body',
				files,
				detail: `${described.join('; ')} have the same body under different names`,
				guidance: 'Renaming the identifiers did not make these different functions.',
			}),
		);
	},
};
