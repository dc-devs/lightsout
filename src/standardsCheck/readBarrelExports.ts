import { posix } from 'node:path';

const starPattern = /^export\s+\*\s+(?:as\s+[A-Za-z0-9_$]+\s+)?from\s+['"]([^'"]+)['"]/;
const namedPattern = /^export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/;

/** The public name a re-export exposes: the alias when `A as B`, else the source name, with any leading `type` stripped. */
const publicName = (part: string) => {
	const withoutType = part.trim().replace(/^type\s+/, '').trim();
	const aliased = withoutType.match(/\bas\s+([A-Za-z0-9_$]+)$/);

	return aliased?.[1] ?? withoutType;
};

interface Params {
	/** Repo-relative path of the barrel whose text this is — its dir anchors relative specifiers. */
	barrelPath: string;
	/** The barrel file's contents. */
	text: string;
	/** Repo-relative source-file list — the universe relative specifiers resolve against. */
	files: string[];
}

/**
 * Re-export lines of one barrel, each with its resolved repo-relative
 * target. Line-regex parsing mirrors checkStructure's exportPattern — a barrel
 * is named re-exports plus the occasional `export *`, never arbitrary
 * TypeScript, so a compile is overkill. `export *` lines carry `star: true`
 * and no names; every relative specifier resolves against the file list by
 * probing `.ts | .tsx | /index.ts | /index.tsx`, and an unresolvable
 * specifier (external package, missing file) simply carries `target:
 * undefined`.
 */
export const readBarrelExports = ({
	barrelPath,
	text,
	files,
}: Params): Array<{ names: string[]; star: boolean; specifier: string; target: string | undefined }> => {
	const fileSet = new Set(files);
	const barrelDir = posix.dirname(barrelPath);

	const resolveTarget = (specifier: string) => {
		if (!specifier.startsWith('.')) {
			return undefined;
		}

		const base = posix.normalize(posix.join(barrelDir, specifier));

		for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
			if (fileSet.has(candidate)) {
				return candidate;
			}
		}

		return undefined;
	};

	const entries: Array<{ names: string[]; star: boolean; specifier: string; target: string | undefined }> = [];

	for (const line of text.split('\n')) {
		const star = line.match(starPattern);

		if (star?.[1]) {
			entries.push({ names: [], star: true, specifier: star[1], target: resolveTarget(star[1]) });
			continue;
		}

		const named = line.match(namedPattern);

		if (named?.[1] !== undefined && named[2]) {
			const names = named[1].split(',').map(publicName).filter((name) => name.length > 0);

			entries.push({ names, star: false, specifier: named[2], target: resolveTarget(named[2]) });
		}
	}

	return entries;
};
