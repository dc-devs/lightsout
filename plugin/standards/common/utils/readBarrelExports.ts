import type { BarrelExport } from '../types/BarrelExport.ts';
import { findPathAliases } from './findPathAliases.ts';
import { resolveImport } from './resolveImport.ts';

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
	/** Repo-relative path of the barrel to read — its folder anchors relative specifiers, and its package supplies the aliases. */
	barrelPath: string;
	/** The run's file text, holding the barrel and every tsconfig.json in scope. */
	contents: Map<string, string>;
	/** Every file in scope — the universe specifiers resolve against. */
	files: Set<string>;
}

/**
 * The re-export lines of one barrel, each with the names it exposes and what
 * its specifier points at.
 *
 * Line-regex parsing is enough because a barrel is named re-exports plus the
 * occasional `export *`, never arbitrary TypeScript — so the rules that judge a
 * barrel's surface cost a scan rather than a parse. An `export *` line carries
 * `star: true` and no names at all, which is exactly what makes it the thing
 * `barrel-star` objects to: a public API nobody wrote down.
 *
 * Specifiers are resolved through the barrel's own package aliases, because
 * that is how barrels are written wherever the standards apply — the
 * import-path-alias rule requires it. A target that could not be resolved is
 * reported as `unknown` rather than dropped, so a caller can tell a barrel it
 * read from a barrel it merely failed to read.
 */
export const readBarrelExports = ({ barrelPath, contents, files }: Params): BarrelExport[] => {
	const aliases = findPathAliases({ path: barrelPath, contents });
	const exports: BarrelExport[] = [];

	for (const line of (contents.get(barrelPath) ?? '').split('\n')) {
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

		exports.push({ names, star: star !== null, specifier, target: resolveImport({ from: barrelPath, specifier, files, aliases }) });
	}

	return exports;
};
