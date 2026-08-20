import { type FileTextInput, StandardsInputKind } from '#src/contracts/index.ts';
import { readIntoCache } from '#src/standardsCheck/common/checkInputs/readIntoCache.ts';

interface Params {
	cwd: string;
	source: string[];
	tests: string[];
	files: string[];
	referenceFiles: string[];
	/** Repo-relative standards package roots, from the walk that listed the files. */
	standardsPackages: string[];
	/** The run's shared cache — read-through: a path is read from disk at most once per run. */
	cache: Map<string, string>;
}

/**
 * Where an alias declaration could sit for these files: a `tsconfig.json` and a
 * `package.json` per folder holding one, per ancestor of those folders, and the
 * repo root.
 *
 * Both files, because a package declares its aliases in either — `imports` in
 * the manifest, `compilerOptions.paths` in the tsconfig — and a rule asking
 * which alias governs a file must be able to read whichever one the package
 * actually used.
 *
 * Every folder rather than a known list of package roots, because nothing here
 * has decided yet what a package is — and a candidate that does not exist costs
 * a failed read that `readIntoCache` drops, while a package missed costs every
 * rule in it the aliases it needs.
 */
const aliasSourceCandidates = ({ files }: { files: string[] }) => {
	const folders = new Set<string>();

	for (const file of files) {
		let cut = file.lastIndexOf('/');

		while (cut !== -1) {
			const folder = file.slice(0, cut);

			if (folders.has(folder)) {
				break;
			}

			folders.add(folder);
			cut = folder.lastIndexOf('/');
		}
	}

	return ['tsconfig.json', 'package.json', ...[...folders].flatMap((folder) => [`${folder}/tsconfig.json`, `${folder}/package.json`])];
};

/**
 * Text for every file in scope, plus every tsconfig.json and every
 * package.json above one of them — the files that answer "what are this
 * package's path aliases?", which no rule may open for itself and several need.
 *
 * Both files, because a package may declare its aliases in either: `imports` in
 * the manifest, which Node and every bundler resolve natively, or
 * `compilerOptions.paths` in the tsconfig. Handed only the tsconfigs, a rule
 * reads a package that chose the manifest as declaring none.
 *
 * Every folder's rather than the repo root's alone. Path aliases are per
 * package by necessity: a shared base config cannot name paths that would have
 * to mean a different folder in each package that extends it, so in a workspace
 * the root config carries none and each package declares its own. Reading only
 * the root therefore found no aliases anywhere in a monorepo — which left every
 * aliased re-export unresolvable, made every barrel look empty, and had one rule
 * report all 225 of a package's tests as testing private internals.
 *
 * The cache is handed straight back as `contents`: it is the run's one copy of
 * the repo's text, and copying it per rule would defeat the point of reading
 * each file once.
 *
 * @param cache - the run's shared cache, filled in place and returned as the input's contents
 */
export const buildFileTextInput = async ({ cwd, source, tests, files, referenceFiles, standardsPackages, cache }: Params): Promise<FileTextInput> => {
	const inScope = [...new Set([...files, ...referenceFiles])];

	await readIntoCache({ cwd, paths: inScope, cache });
	// A candidate folder holding neither file is simply left out of the cache,
	// which is the "when present" the contract promises — and what makes probing
	// every folder cheaper than deciding in advance which ones are packages.
	await readIntoCache({ cwd, paths: aliasSourceCandidates({ files: inScope }), cache });

	return { kind: StandardsInputKind.FileText, cwd, source, tests, files, referenceFiles, contents: cache, standardsPackages };
};
