import { getPathCarveOut } from '../frameworks/getPathCarveOut.ts';
import { isFrameworkLoadedFile } from '../frameworks/isFrameworkLoadedFile.ts';
import { readFileExports } from '../parsing/readFileExports.ts';
import { isBarrelFile } from '../paths/isBarrelFile.ts';
import { isTestFile } from '../paths/isTestFile.ts';
import type { FrameworkCarveOut } from '../types/FrameworkCarveOut.ts';
import type { UnconsumedExport } from '../types/UnconsumedExport.ts';

/**
 * An index file is a BARREL only if it exports. An entry index that only
 * imports and runs is an ordinary consumer — counting it as a barrel reads
 * every command a dispatcher invokes as "public but unconsumed".
 */
const isBarrel = ({ file, text }: { file: string; text: string }) => isBarrelFile({ path: file }) && /^export\b/m.test(text);

interface Params {
	/** Files in scope — only these are judged, though everything in `contents` may reference them. */
	files: string[];
	/** Text for every file in scope and every reference file. */
	contents: Map<string, string>;
	/** Repo-relative standards pack roots, so a pack's `tests/` document set is not read as test code. */
	standardsPacks: string[];
	/** Every package's framework carve-outs, as `getFrameworkCarveOuts` returns them — a framework-resolved file is a consumer, never a barrel. */
	carveOuts: FrameworkCarveOut[];
}

/**
 * Every export in scope that no production file references, each with what does
 * still mention it — a barrel, a test, or neither.
 *
 * Whole-word name counting, which is honest here because one-export-per-file
 * makes every export a distinct searchable name. Conservative by construction:
 * a name mentioned in a comment or a string counts as a reference, so calling a
 * live export unconsumed is rare. Names under four characters are skipped —
 * they collide with ordinary words too often to measure. Barrels, test files
 * and files the framework resolves declare nothing that is judged: a barrel's
 * names belong to the file it re-exports, a test's helpers are the test's own,
 * and a framework-resolved file's exports answer to the framework rather than
 * to any import.
 */
export const getUnconsumedExports = ({ files, contents, standardsPacks, carveOuts }: Params): UnconsumedExport[] => {
	const scope = new Set(files);
	const declarations: Array<{ name: string; file: string }> = [];

	for (const [file, text] of contents) {
		if (
			!scope.has(file) ||
			isBarrelFile({ path: file }) ||
			isTestFile({ path: file, standardsPacks }) ||
			isFrameworkLoadedFile({ path: file, carveOut: getPathCarveOut({ carveOuts, path: file }) })
		) {
			continue;
		}

		for (const { name } of readFileExports({ text })) {
			if (name.length >= 4) {
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

			if (isTestFile({ path: other, standardsPacks })) {
				reachedBy.test = true;
			} else if (isFrameworkLoadedFile({ path: other, carveOut: getPathCarveOut({ carveOuts, path: other }) })) {
				source = true;
			} else if (isBarrel({ file: other, text })) {
				reachedBy.barrel = true;
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
