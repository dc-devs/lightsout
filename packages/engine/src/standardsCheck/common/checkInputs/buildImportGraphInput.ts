import type ts from 'typescript';
import { collectImportEdges } from '#src/common/moduleGraph/collectImportEdges.ts';
import { type ImportGraphInput, StandardsInputKind } from '#src/contracts/index.ts';

interface Params {
	cwd: string;
	source: string[];
	tests: string[];
	files: string[];
	referenceFiles: string[];
	/** Repo-relative standards package roots, from the walk that listed the files. */
	standardsPackages: string[];
	compiler: typeof ts;
}

/**
 * Who imports whom, across the WHOLE repo rather than the scoped file list: a
 * boundary rule's question is "does anything outside this module reach into
 * it?", and a graph built from the scope alone would answer it wrong whenever
 * the run is narrowed with `--path`.
 */
export const buildImportGraphInput = async ({ cwd, source, tests, files, referenceFiles, standardsPackages, compiler }: Params): Promise<ImportGraphInput> => {
	const edges = await collectImportEdges({ cwd, files: referenceFiles, compiler });

	return { kind: StandardsInputKind.ImportGraph, cwd, source, tests, files, referenceFiles, standardsPackages, edges };
};
