import type { FileExport } from '../types/FileExport.ts';

/**
 * A declaration exported on the line it is defined. The name position rejects
 * `${` before capturing: a code GENERATOR emits its output as a template
 * literal, so a line like `export const ${exportName}: …` sits inside a string
 * yet still starts at column 0, and a line-anchored pattern would read it as a
 * declaration. `${` can never open a real identifier, so the guard costs no
 * true positives.
 */
const exportLine = /^export\s+(?:async\s+)?(const|class|function|interface|type|enum)\s+(?!\$\{)([A-Za-z0-9_$]+)/;

interface Params {
	/** One file's whole text. */
	text: string;
}

/**
 * Every declaration a file exports, in the order it declares them.
 *
 * Two rules of the structure standards ask the same question of a file — how
 * many exports does it hold, and what is the first one called — so the line
 * scan that answers it is written once here rather than twice with a different
 * bug in each.
 */
export const readFileExports = ({ text }: Params): FileExport[] => {
	const exports: FileExport[] = [];

	for (const line of text.split('\n')) {
		const [, keyword, name] = exportLine.exec(line) ?? [];

		if (keyword !== undefined && name !== undefined) {
			exports.push({ keyword, name, line });
		}
	}

	return exports;
};
