import { type FileListInput, StandardsInputKind } from '#src/contracts/index.ts';
import { readPackageDependencies } from '#src/standardsCheck/common/checkInputs/readPackageDependencies.ts';

interface Params {
	cwd: string;
	source: string[];
	tests: string[];
	files: string[];
	referenceFiles: string[];
	/** Repo-relative standards pack roots, from the walk that listed the files. */
	standardsPacks: string[];
	/** Monorepo package parent dir (config `packages-dir`, default 'packages'). */
	packagesDir: string;
}

/**
 * The path-only input, plus the one fact it carries that a path list cannot
 * show: what each package declares it depends on. The declarations are read
 * the same way channel detection reads them, so a rule asking "does this repo
 * use React?" gets the same answer either route.
 *
 * @param packagesDir - monorepo package parent dir; each child holding a package.json becomes an entry
 */
export const buildFileListInput = async ({ cwd, source, tests, files, referenceFiles, standardsPacks, packagesDir }: Params): Promise<FileListInput> => {
	const dependencies = await readPackageDependencies({ cwd, packagesDir });

	return { kind: StandardsInputKind.FileList, cwd, source, tests, files, referenceFiles, dependencies, standardsPacks };
};
