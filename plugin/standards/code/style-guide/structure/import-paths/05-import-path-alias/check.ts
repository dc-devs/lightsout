import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { readFileTexts } from '../../../../../common/checkInput/readFileTexts.ts';
import { ImportTargetKind } from '../../../../../common/constants/ImportTargetKind.ts';
import { buildRawFinding } from '../../../../../common/findings/buildRawFinding.ts';
import { findPathAliases } from '../../../../../common/imports/findPathAliases.ts';
import { resolveImport } from '../../../../../common/imports/resolveImport.ts';
import { isUnderSrc } from '../../../../../common/paths/isUnderSrc.ts';

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
	 * Judged per file against the aliases of the package that holds it — which in
	 * a monorepo is the only place they are declared, since a shared base config
	 * cannot name paths that would mean something different in each package.
	 * Asking the repo root alone, as this rule once did, found no aliases
	 * anywhere in a workspace and quietly judged nothing.
	 *
	 * A package with no aliases is told by this very document to use relative
	 * paths, so the rule has nothing to say there. A package whose aliases could
	 * not be read is not judged at all: the fix this rule asks for is "write the
	 * alias instead", and it cannot name one it never saw. Either declaration
	 * answers — `package.json` → `imports` or `tsconfig.json` →
	 * `compilerOptions.paths` — which is why the guidance below names both.
	 *
	 * Only files inside a `src` tree, which is what those aliases are configured
	 * to reach, and only specifiers that resolve to a file in scope — which
	 * silences asset imports, relative for reasons an alias cannot answer.
	 */
	run: ({ input }): RawStandardsFinding[] => {
		const { files, contents } = readFileTexts({ input });
		const fileSet = new Set(files);

		return files
			.filter((file) => isUnderSrc({ path: file }))
			.map((file) => {
				const aliases = findPathAliases({ path: file, contents });

				if (aliases === undefined || aliases.patterns.size === 0) {
					return undefined;
				}

				const relative = getSpecifiers({ text: contents.get(file) ?? '' })
					.filter((specifier) => specifier.startsWith('.'))
					.filter((specifier) => resolveImport({ from: file, specifier, files: fileSet, aliases }).kind === ImportTargetKind.File);

				return relative.length === 0
					? undefined
					: buildRawFinding({
							rule: 'import-path-alias',
							files: [{ path: file }],
							detail: `${relative.map((specifier) => `'${specifier}'`).join(', ')} ${relative.length > 1 ? 'are' : 'is'} imported by relative path`,
							guidance:
								"Import through the package's configured alias — read the package's `package.json` → `imports` or `tsconfig.json` → `compilerOptions.paths` for the right one.",
						});
			})
			.filter((finding): finding is RawStandardsFinding => finding !== undefined);
	},
};
