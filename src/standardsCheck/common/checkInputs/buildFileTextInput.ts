import { StandardsInputKind, type FileTextInput } from '@/contracts';
import { readIntoCache } from '@/standardsCheck/common/checkInputs/readIntoCache';

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
 * Text for every file in scope, plus the repo's own tsconfig.json when it has
 * one — the file that answers "what are this package's path aliases?", which no
 * rule may open for itself and several need.
 *
 * The cache is handed straight back as `contents`: it is the run's one copy of
 * the repo's text, and copying it per rule would defeat the point of reading
 * each file once.
 *
 * @param cache - the run's shared cache, filled in place and returned as the input's contents
 */
export const buildFileTextInput = async ({ cwd, source, tests, files, referenceFiles, standardsPackages, cache }: Params): Promise<FileTextInput> => {
	await readIntoCache({ cwd, paths: [...new Set([...files, ...referenceFiles])], cache });
	// Absent on a JS-only repo — readIntoCache simply leaves it out, which is
	// the "when present" the contract promises.
	await readIntoCache({ cwd, paths: ['tsconfig.json'], cache });

	return { kind: StandardsInputKind.FileText, cwd, source, tests, files, referenceFiles, contents: cache, standardsPackages };
};
