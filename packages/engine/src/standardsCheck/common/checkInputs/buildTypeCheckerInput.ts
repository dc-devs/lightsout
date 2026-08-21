import { dirname, join, resolve } from 'node:path';
import type ts from 'typescript';
import { StandardsInputKind, type TypeCheckerInput } from '#src/contracts/index.ts';
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
	/** Monorepo package parent dir (config `packages-dir`, default 'packages'). */
	packagesDir: string;
}

/**
 * The nearest tsconfig.json at or above a file, or undefined when the walk
 * reaches the repo root without finding one.
 *
 * Nearest rather than the repo's, because a workspace declares its compiler
 * options per package — path aliases above all. A file typed against the wrong
 * config resolves its imports to nothing, and a checker that resolved nothing
 * reports `any` everywhere, which reads to a rule as "no finding here".
 */
const findNearestConfig = ({ cwd, path, compiler }: { cwd: string; path: string; compiler: typeof ts }): string | undefined => {
	let folder = dirname(resolve(cwd, path));

	while (folder.startsWith(cwd)) {
		const candidate = join(folder, 'tsconfig.json');

		if (compiler.sys.fileExists(candidate)) {
			return candidate;
		}

		folder = dirname(folder);
	}

	return undefined;
};

/**
 * One program per tsconfig, built from that config's own file list rather than
 * from the paths in scope. A program missing a file its members import types
 * from cannot resolve them, and the check reads the gap as an absence of
 * findings rather than as an absence of information.
 */
const buildPrograms = ({ configPaths, compiler }: { configPaths: Set<string>; compiler: typeof ts }) => {
	const programs = new Map<string, ts.Program>();

	for (const configPath of configPaths) {
		const read = compiler.readConfigFile(configPath, compiler.sys.readFile);

		if (read.error !== undefined) {
			continue;
		}

		const parsed = compiler.parseJsonConfigFileContent(read.config, compiler.sys, dirname(configPath));

		programs.set(configPath, compiler.createProgram({ rootNames: parsed.fileNames, options: parsed.options }));
	}

	return programs;
};

/**
 * Every file the engine could type, each with the checker of the program that
 * holds it.
 *
 * The expensive input, and the only one that resolves a name to its
 * declaration: a rule reading this can ask what a value's DECLARED type is,
 * across files, rather than inferring from the characters in front of it. That
 * buys the questions a tree cannot answer — whether a compared literal is a
 * member of a discriminant union, which module's export an imported name really
 * came from — and costs a full type-check of each program, so it is built only
 * when a rule asks for it.
 *
 * Every file in scope AND every reference file, on the same terms as the
 * file-text input's `contents`: a rule that asks "does anything consume this?"
 * needs the consumers typed too, and a consumer may be a test, or a file
 * outside a `--path` scope. Which of them a rule may REPORT on is a separate
 * question, answered by `source`, `tests` and `files` — the same separation
 * every other input draws.
 *
 * A file no program holds is left out rather than guessed at. That covers the
 * ordinary cases — a file excluded by its config, a folder with no tsconfig
 * above it — and keeps the same contract the other typed inputs have: a rule
 * answers about what it was handed.
 */
export const buildTypeCheckerInput = async ({
	cwd,
	source,
	tests,
	files,
	referenceFiles,
	standardsPackages,
	compiler,
	packagesDir,
}: Params): Promise<TypeCheckerInput> => {
	const configOf = new Map<string, string>();

	for (const path of new Set([...files, ...referenceFiles])) {
		const configPath = findNearestConfig({ cwd, path, compiler });

		if (configPath !== undefined) {
			configOf.set(path, configPath);
		}
	}

	const programs = buildPrograms({ configPaths: new Set(configOf.values()), compiler });
	const typedFiles = new Map<string, { sourceFile: ts.SourceFile; checker: ts.TypeChecker }>();

	for (const [path, configPath] of configOf) {
		const program = programs.get(configPath);
		const sourceFile = program?.getSourceFile(resolve(cwd, path));

		if (program !== undefined && sourceFile !== undefined) {
			typedFiles.set(path, { sourceFile, checker: program.getTypeChecker() });
		}
	}

	return {
		kind: StandardsInputKind.TypeChecker,
		cwd,
		source,
		tests,
		files,
		referenceFiles,
		standardsPackages,
		compiler,
		typedFiles,
		dependencies: await readPackageDependencies({ cwd, packagesDir }),
	};
};
