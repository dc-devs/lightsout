import type { UnconsumedExport } from '../types/UnconsumedExport.ts';
import { getBaseName } from './getBaseName.ts';
import { isTestFile } from './isTestFile.ts';

const exportPattern = /^export\s+(?:async\s+)?(?:const|class|function|interface|type|enum)\s+([A-Za-z0-9_$]+)/;

/**
 * An index file is a BARREL only if it exports. An entry index that only
 * imports and runs is an ordinary consumer — counting it as a barrel reads
 * every command a dispatcher invokes as "public but unconsumed".
 */
const isBarrel = ({ file, text }: { file: string; text: string }) => getBaseName({ path: file }).startsWith('index.') && /^export\b/m.test(text);

interface Params {
	/** Files in scope — only these are judged, though everything in `contents` may reference them. */
	files: string[];
	/** Text for every file in scope and every reference file. */
	contents: Map<string, string>;
	/** Repo-relative standards package roots, so a package's `tests/` document set is not read as test code. */
	standardsPackages: string[];
}

/**
 * Every export in scope that no production file references, each with what does
 * still mention it — a barrel, a test, or neither.
 *
 * Whole-word name counting, which is honest here because one-export-per-file
 * makes every export a distinct searchable name. Conservative by construction:
 * a name mentioned in a comment or a string counts as a reference, so calling a
 * live export unconsumed is rare. Names under four characters are skipped —
 * they collide with ordinary words too often to measure. Barrels and test files
 * declare nothing that is judged: a barrel's names belong to the file it
 * re-exports, and a test's helpers are the test's own.
 */
export const getUnconsumedExports = ({ files, contents, standardsPackages }: Params): UnconsumedExport[] => {
	const scope = new Set(files);
	const declarations: Array<{ name: string; file: string }> = [];

	for (const [file, text] of contents) {
		if (!scope.has(file) || getBaseName({ path: file }).startsWith('index.') || isTestFile({ path: file, standardsPackages })) {
			continue;
		}

		for (const line of text.split('\n')) {
			const name = line.match(exportPattern)?.[1];

			if (name !== undefined && name.length >= 4) {
				declarations.push({ name, file });
			}
		}
	}

	const unconsumed: UnconsumedExport[] = [];

	for (const { name, file } of declarations) {
		const pattern = new RegExp(`\\b${name}\\b`);
		const reachedBy = { barrel: false, test: false };
		let source = false;

		for (const [other, text] of contents) {
			if (other === file || !pattern.test(text)) {
				continue;
			}

			if (isBarrel({ file: other, text })) {
				reachedBy.barrel = true;
			} else if (isTestFile({ path: other, standardsPackages })) {
				reachedBy.test = true;
			} else {
				source = true;
			}
		}

		if (!source) {
			unconsumed.push({ file, name, reachedBy });
		}
	}

	return unconsumed;
};
