import type ts from 'typescript';
import { collectImportEdges } from '#src/common/moduleGraph/collectImportEdges.ts';
import { type ImportGraphInput, StandardsInputKind } from '#src/contracts/index.ts';
import { readPackageDependencies } from '#src/standardsCheck/common/checkInputs/readPackageDependencies.ts';

interface Params {
	cwd: string;
	source: string[];
	tests: string[];
	files: string[];
	referenceFiles: string[];
	/** Repo-relative standards pack roots, from the walk that listed the files. */
	standardsPacks: string[];
	compiler: typeof ts;
	/** Monorepo package parent dir (config `packages-dir`, default 'packages'). */
	packagesDir: string;
}

/**
 * Who imports whom, across the WHOLE repo rather than the scoped file list: a
 * boundary rule's question is "does anything outside this module reach into
 * it?", and a graph built from the scope alone would answer it wrong whenever
 * the run is narrowed with `--path`.
 *
 * The graph carries what each package declares alongside the edges, because a
 * boundary rule's other question is whether the folder it is judging is one a
 * framework mandates — and that is answered by the declarations, never by the
 * graph.
 */
export const buildImportGraphInput = async ({
	cwd,
	source,
	tests,
	files,
	referenceFiles,
	standardsPacks,
	compiler,
	packagesDir,
}: Params): Promise<ImportGraphInput> => {
	const edges = await collectImportEdges({ cwd, files: referenceFiles, compiler });
	const dependencies = await readPackageDependencies({ cwd, packagesDir });

	return { kind: StandardsInputKind.ImportGraph, cwd, source, tests, files, referenceFiles, standardsPacks, edges, dependencies };
};
