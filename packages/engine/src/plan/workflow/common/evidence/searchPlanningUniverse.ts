import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { PlanningEvidenceRequest, PlanningVocabulary } from '#src/contracts/index.ts';
import { readPlanningUniverse } from '#src/plan/workflow/common/evidence/readPlanningUniverse.ts';

interface Params {
	cwd: string;
	request: Extract<PlanningEvidenceRequest, { operation: typeof PlanningVocabulary.Operation.Search }>;
}

/** Exact text search with an independently hashed complete input universe, including negative matches. */
export const searchPlanningUniverse = async ({
	cwd,
	request,
}: Params): Promise<{
	matches: Array<{ path: string; line: number; text: string }>;
	sources: Map<string, string>;
	unknown: boolean;
	omissions: Array<{ path: string; kind: string; target?: string }>;
	universeFingerprint: string;
	resultFingerprint: string;
}> => {
	const pattern = request.options.regex ? new RegExp(request.query, request.options.caseSensitive ? '' : 'i') : undefined;
	const universe = await readPlanningUniverse({ cwd, roots: request.roots, exclude: request.options.exclude, glob: request.options.glob, contents: true });
	const matchedPaths = new Set<string>();
	const query = request.options.caseSensitive ? request.query : request.query.toLocaleLowerCase('en-US');
	const matches: Array<{ path: string; line: number; text: string }> = [];
	for (const file of universe.files) {
		if (file.content === undefined) continue;
		for (const [index, line] of file.content.split(/\r?\n/).entries()) {
			const found = pattern === undefined ? (request.options.caseSensitive ? line : line.toLocaleLowerCase('en-US')).includes(query) : pattern.test(line);
			if (found) {
				matches.push({ path: file.path, line: index + 1, text: line });
				matchedPaths.add(file.path);
			}
		}
	}
	return {
		matches,
		sources: new Map(universe.files.filter((file) => file.content !== undefined && matchedPaths.has(file.path)).map((file) => [file.path, file.content ?? ''])),
		unknown: universe.unknown,
		omissions: universe.members.filter((member) => member.kind === 'symlink' || member.kind === 'other'),
		universeFingerprint: sha256({
			content: canonicalJson({ value: { members: universe.members, files: universe.files.map(({ path, sha256 }) => ({ path, sha256 })) } }),
		}),
		resultFingerprint: sha256({ content: canonicalJson({ value: matches }) }),
	};
};
