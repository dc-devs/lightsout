import type { RawStandardsFinding, StandardsCheckModule } from '@/contracts';
import { buildRawFinding } from '../../../../../common/utils/buildRawFinding.ts';
import { isUnderSrc } from '../../../../../common/utils/isUnderSrc.ts';
import { readFileTexts } from '../../../../../common/utils/readFileTexts.ts';
import { resolveRelativeImport } from '../../../../../common/utils/resolveRelativeImport.ts';

/**
 * A `paths` block holding at least one alias — the tsconfig fact that turns a
 * relative import from the only option into the wrong one. Matched on the text
 * rather than parsed, because a tsconfig is routinely written with comments and
 * trailing commas that no JSON parser accepts, and the question here is only
 * whether the block has an entry in it.
 */
const aliasBlock = /"paths"\s*:\s*\{\s*"[^"]+"\s*:/;

/** The specifier of an import or re-export: the one-line form, and the closing line of a wrapped one. */
const fromClause = /^(?:import|export)\s[^'"]*from\s*['"]([^'"]+)['"]|^\}\s*from\s*['"]([^'"]+)['"]/;
/** A side-effect import, which names no bindings at all. */
const bareImport = /^import\s*['"]([^'"]+)['"]/;

const getSpecifiers = ({ text }: { text: string }) => {
	const specifiers: string[] = [];

	for (const line of text.split('\n')) {
		const match = fromClause.exec(line);
		const specifier = match?.[1] ?? match?.[2] ?? bareImport.exec(line)?.[1];

		if (specifier !== undefined) {
			specifiers.push(specifier);
		}
	}

	return specifiers;
};

export const check: StandardsCheckModule = {
	inputKind: 'file-text',
	/**
	 * Judged only where the repo's own tsconfig declares aliases — a package with
	 * none is told by this very document to use relative paths, so the rule has
	 * nothing to say there — and only for files inside a `src` tree, which is
	 * what those aliases are configured to reach.
	 *
	 * A specifier counts only when it resolves to a file in scope. That silences
	 * asset imports and package specifiers, which are relative for reasons an
	 * alias cannot answer, and keeps the rule to what it is about: one source
	 * file reaching another by walking the folder tree.
	 */
	run: ({ input }): RawStandardsFinding[] => {
		const { files, contents } = readFileTexts({ input });

		if (!aliasBlock.test(contents.get('tsconfig.json') ?? '')) {
			return [];
		}

		const fileSet = new Set(files);

		return files
			.filter((file) => isUnderSrc({ path: file }))
			.map((file) => {
				const relative = getSpecifiers({ text: contents.get(file) ?? '' }).filter(
					(specifier) => resolveRelativeImport({ from: file, specifier, files: fileSet }) !== undefined,
				);

				return relative.length === 0
					? undefined
					: buildRawFinding({
							rule: 'import-path-alias',
							files: [{ path: file }],
							detail: `${relative.map((specifier) => `'${specifier}'`).join(', ')} ${relative.length > 1 ? 'are' : 'is'} imported by relative path`,
							guidance: "Import through the package's configured alias — read `tsconfig.json` → `compilerOptions.paths` for the right one.",
						});
			})
			.filter((finding): finding is RawStandardsFinding => finding !== undefined);
	},
};
