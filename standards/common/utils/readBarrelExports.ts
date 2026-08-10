import type { BarrelExport } from '../types/BarrelExport.ts';
import { resolveRelativeImport } from './resolveRelativeImport.ts';

const starLine = /^export\s+\*\s+(?:as\s+[A-Za-z0-9_$]+\s+)?from\s+['"]([^'"]+)['"]/;
const namedLine = /^export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/;

/** The public name a re-export exposes: the alias when `A as B`, else the source name, with any leading `type` stripped. */
const getPublicName = ({ part }: { part: string }) => {
	const withoutType = part
		.trim()
		.replace(/^type\s+/, '')
		.trim();

	return /\bas\s+([A-Za-z0-9_$]+)$/.exec(withoutType)?.[1] ?? withoutType;
};

interface Params {
	/** Repo-relative path of the barrel whose text this is — its folder anchors relative specifiers. */
	barrelPath: string;
	/** The barrel file's contents. */
	text: string;
	/** Every file in scope — the universe relative specifiers resolve against. */
	files: Set<string>;
}

/**
 * The re-export lines of one barrel, each with the names it exposes and the
 * file it resolves to.
 *
 * Line-regex parsing is enough because a barrel is named re-exports plus the
 * occasional `export *`, never arbitrary TypeScript — so the rules that judge a
 * barrel's surface cost a scan rather than a parse. An `export *` line carries
 * `star: true` and no names at all, which is exactly what makes it the thing
 * `barrel-star` objects to: a public API nobody wrote down.
 *
 * @param barrelPath - repo-relative path of the barrel
 * @param text - the barrel file's contents
 * @param files - every file in scope
 */
export const readBarrelExports = ({ barrelPath, text, files }: Params): BarrelExport[] => {
	const exports: BarrelExport[] = [];

	for (const line of text.split('\n')) {
		const star = starLine.exec(line);
		const named = star === null ? namedLine.exec(line) : null;
		const specifier = star?.[1] ?? named?.[2];
		const entries = named?.[1];

		if (specifier === undefined) {
			continue;
		}

		const names =
			entries === undefined
				? []
				: entries
						.split(',')
						.map((part) => getPublicName({ part }))
						.filter((name) => name.length > 0);

		exports.push({ names, star: star !== null, specifier, target: resolveRelativeImport({ from: barrelPath, specifier, files }) });
	}

	return exports;
};
