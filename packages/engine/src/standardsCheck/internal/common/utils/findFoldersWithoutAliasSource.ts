interface Params {
	/** Repo-relative paths of the files the run judged. */
	files: string[];
	/** The run's file text, which carries every tsconfig.json and package.json the run found. */
	contents: Map<string, string>;
}

/** Whether one manifest's text declares an `imports` map — the package-private alias mechanism. */
const declaresImports = ({ text }: { text: string }) => {
	let data: unknown;

	try {
		data = JSON.parse(text);
	} catch {
		return false;
	}

	if (typeof data !== 'object' || data === null || !('imports' in data)) {
		return false;
	}

	return typeof data.imports === 'object' && data.imports !== null && !Array.isArray(data.imports);
};

/**
 * The folders holding judged files that no alias declaration sits above —
 * neither a `tsconfig.json` nor a `package.json` that declares `imports`.
 *
 * A rule resolving an import needs the path aliases of the package holding the
 * file, and a package that declares them nowhere has none to give. Those rules
 * then cannot tell an alias from a published package, so they stay silent
 * rather than guess — correct, and invisible. This is what makes it visible:
 * the run names the folders it could not answer for, so a clean report is never
 * mistaken for a question nobody asked.
 *
 * A manifest counts only when it actually declares `imports`. Every package
 * ships a `package.json`, so treating the file's mere presence as an answer
 * would report the whole repo covered and this note would never fire again.
 *
 * Folders rather than files, because the answer is identical for every file in
 * one and a list of six hundred paths is not a note anybody reads.
 */
export const findFoldersWithoutAliasSource = ({ files, contents }: Params): string[] => {
	const answered = new Map<string, boolean>();

	const parentOf = ({ folder }: { folder: string }) => {
		const cut = folder.lastIndexOf('/');

		return cut === -1 ? '.' : folder.slice(0, cut);
	};

	const hasAliasSource = ({ folder }: { folder: string }): boolean => {
		const cached = answered.get(folder);

		if (cached !== undefined) {
			return cached;
		}

		const manifest = contents.get(folder === '.' ? 'package.json' : `${folder}/package.json`);
		const found =
			contents.has(folder === '.' ? 'tsconfig.json' : `${folder}/tsconfig.json`) ||
			(manifest !== undefined && declaresImports({ text: manifest })) ||
			(folder !== '.' && hasAliasSource({ folder: parentOf({ folder }) }));

		answered.set(folder, found);

		return found;
	};

	const uncovered = new Set<string>();

	for (const file of files) {
		const folder = parentOf({ folder: file });

		if (!hasAliasSource({ folder })) {
			uncovered.add(folder);
		}
	}

	return [...uncovered].sort();
};
