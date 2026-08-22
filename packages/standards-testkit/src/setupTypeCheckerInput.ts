import { dirname, resolve } from 'node:path';
import type { StandardsCheckInput, TypeCheckerInput } from '@lightsout/standards-contracts';
import { StandardsInputKind } from '@lightsout/standards-contracts';
import ts from 'typescript';

interface Params extends Partial<Omit<TypeCheckerInput, 'kind' | 'typedFiles' | 'compiler' | 'dependencies'>> {
	sources?: Array<[string, string]>;
	dependencies?: Array<[string, string[]]>;
}

/** Where the arranged files live, so a relative import has a folder to resolve against. */
const root = '/repo';

/**
 * `noLib`, because the arranged files are a few lines each and never touch a
 * global — loading the standard library into every rule's unit test would cost
 * more than everything those tests do together.
 */
const options: ts.CompilerOptions = { target: ts.ScriptTarget.Latest, strict: true, noEmit: true, noLib: true };

/**
 * A real compiler host with two methods replaced: the arranged files are served
 * from memory, and imports among them are resolved by path rather than by
 * TypeScript's own resolver.
 *
 * Resolution is taken over rather than left alone because the resolver reaches
 * the filesystem through a dozen host methods, and an import it cannot resolve
 * does not fail — it types the importer's values as `any`, and a rule reading
 * those types then reports nothing. A test arranging a cross-file type would
 * pass while proving the opposite of what it says.
 */
const setupHost = ({ trees }: { trees: Map<string, ts.SourceFile> }): ts.CompilerHost => {
	const host = ts.createCompilerHost(options, true);

	host.getSourceFile = (name) => trees.get(name);
	host.resolveModuleNameLiterals = (literals, containingFile) =>
		literals.map((literal) => {
			const target = resolve(dirname(containingFile), literal.text);
			// A specifier may be written with the extension, without it, or as the
			// `.js` a bundler-free build emits — all three name the same file here.
			const resolvedFileName = [target, `${target}.ts`, target.replace(/\.js$/, '.ts')].find((candidate) => trees.has(candidate));

			return resolvedFileName === undefined ? { resolvedModule: undefined } : { resolvedModule: { resolvedFileName, extension: ts.Extension.Ts } };
		});

	return host;
};

/**
 * The input a `type-checker` check receives: the arranged sources as one
 * program, each paired with a checker that resolves names across them.
 *
 * @param sources - each file and its text, as pairs; paths are taken as repo-relative and rooted under `/repo`
 * @param dependencies - declared dependency names per package directory, as pairs — the same shape the other factories take, so a rule needing a framework carve-out is arranged the same way whichever input it reads
 */
export const setupTypeCheckerInput = ({ sources = [], dependencies = [], ...overrides }: Params = {}): StandardsCheckInput => {
	// Parsed once and carried by path, so the tree the program holds and the tree
	// a check is handed are the same object — a checker only answers about nodes
	// from its own program.
	const parsed = sources.map(([path, text]) => ({ path, sourceFile: ts.createSourceFile(resolve(root, path), text, ts.ScriptTarget.Latest, true) }));
	const trees = new Map(parsed.map(({ sourceFile }) => [sourceFile.fileName, sourceFile]));
	const program = ts.createProgram({ rootNames: [...trees.keys()], options, host: setupHost({ trees }) });
	const checker = program.getTypeChecker();

	return {
		kind: StandardsInputKind.TypeChecker,
		cwd: root,
		source: parsed.map(({ path }) => path),
		tests: [],
		files: parsed.map(({ path }) => path),
		referenceFiles: [],
		standardsPacks: [],
		compiler: ts,
		typedFiles: new Map(parsed.map(({ path, sourceFile }) => [path, { sourceFile, checker }])),
		dependencies: new Map(dependencies),
		...overrides,
	};
};
