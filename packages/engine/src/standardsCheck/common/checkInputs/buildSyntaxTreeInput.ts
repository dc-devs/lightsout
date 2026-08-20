import type ts from 'typescript';
import { StandardsInputKind, type SyntaxTreeInput } from '#src/contracts/index.ts';
import { readIntoCache } from '#src/standardsCheck/common/checkInputs/readIntoCache.ts';
import { readPackageDependencies } from '#src/standardsCheck/common/checkInputs/readPackageDependencies.ts';

interface Params {
	cwd: string;
	source: string[];
	tests: string[];
	files: string[];
	referenceFiles: string[];
	/** Repo-relative standards package roots, from the walk that listed the files. */
	standardsPackages: string[];
	/** The consumer's TypeScript — the engine never bundles a compiler of its own. */
	compiler: typeof ts;
	cache: Map<string, string>;
	/** Monorepo package parent dir (config `packages-dir`, default 'packages'). */
	packagesDir: string;
}

/**
 * One parsed source file per path in `source`, produced once for the whole run.
 * Parsing is the expensive half of an AST rule, so several rules sharing this
 * input pay for it once between them.
 *
 * Parents are set on the nodes: a rule that has to ask what encloses a node
 * cannot walk back up without them, and there is no cheaper moment to record it.
 */
export const buildSyntaxTreeInput = async ({
	cwd,
	source,
	tests,
	files,
	referenceFiles,
	standardsPackages,
	compiler,
	cache,
	packagesDir,
}: Params): Promise<SyntaxTreeInput> => {
	const texts = await readIntoCache({ cwd, paths: source, cache });
	const dependencies = await readPackageDependencies({ cwd, packagesDir });
	const trees = new Map<string, ts.SourceFile>();

	for (const [path, text] of texts) {
		trees.set(path, compiler.createSourceFile(path, text, compiler.ScriptTarget.Latest, true));
	}

	return { kind: StandardsInputKind.SyntaxTree, cwd, source, tests, files, referenceFiles, standardsPackages, compiler, trees, dependencies };
};
