import type ts from 'typescript';
import type { CloneSpan } from '#src/CloneSpan.ts';
import type { StandardsInputKind } from '#src/StandardsInputKind.ts';

export interface FileListInput {
	kind: typeof StandardsInputKind.FileList;
	cwd: string;
	source: string[];
	tests: string[];
	files: string[];
	referenceFiles: string[];
	/** Declared dependency names per package dir ('.' for the repo root) — engine-read from each package.json. */
	dependencies: Map<string, string[]>;
	/** Repo-relative roots of the standards packs in the tree. Inside one, a `tests/` folder names a document set rather than a directory of tests — pass it to `isTestFile`. */
	standardsPacks: string[];
}

export interface FileTextInput {
	kind: typeof StandardsInputKind.FileText;
	cwd: string;
	source: string[];
	tests: string[];
	files: string[];
	referenceFiles: string[];
	/**
	 * Text for every path in `files` ∪ `referenceFiles`, plus every tsconfig.json
	 * and every package.json sitting above one of them, when present; each file
	 * read once for the whole run.
	 *
	 * Every tsconfig, not just the root's, because path aliases are declared per
	 * package — a rule resolving one file's imports must read the nearest config
	 * above THAT file, not the workspace's.
	 *
	 * The manifests are promised for the same reason: a package may declare its
	 * aliases in `package.json` → `imports` instead, and they also carry the
	 * dependency lists a rule needs to tell which framework mandates govern a
	 * file.
	 */
	contents: Map<string, string>;
	/** Repo-relative roots of the standards packs in the tree. Inside one, a `tests/` folder names a document set rather than a directory of tests — pass it to `isTestFile`. */
	standardsPacks: string[];
}

export interface SyntaxTreeInput {
	kind: typeof StandardsInputKind.SyntaxTree;
	cwd: string;
	source: string[];
	tests: string[];
	files: string[];
	referenceFiles: string[];
	compiler: typeof ts;
	/** One parsed SourceFile per path in `source`. */
	trees: Map<string, ts.SourceFile>;
	/** What each package declares it depends on, keyed by package root (`.` for the repo). A framework carve-out is keyed on what a package DECLARES, so an AST rule needs this to honour one. */
	dependencies: Map<string, string[]>;
	/** Repo-relative roots of the standards packs in the tree. Inside one, a `tests/` folder names a document set rather than a directory of tests — pass it to `isTestFile`. */
	standardsPacks: string[];
}

export interface TypeCheckerInput {
	kind: typeof StandardsInputKind.TypeChecker;
	cwd: string;
	source: string[];
	tests: string[];
	files: string[];
	referenceFiles: string[];
	compiler: typeof ts;
	/**
	 * One entry per file the engine could type — every path in `files` ∪
	 * `referenceFiles`, tests included — holding the parsed tree and a checker
	 * that answers about it.
	 *
	 * Wider than `source` on purpose, the same way the file-text input's
	 * `contents` is: a rule asking "does anything consume this?" needs its
	 * consumers typed, and a consumer may be a test or a file outside a `--path`
	 * scope. Which files a rule may REPORT on is a separate question that
	 * `source`, `tests` and `files` answer.
	 *
	 * The checker is handed out per file rather than once for the run because a
	 * repo has one program per tsconfig, and a type is only meaningful to the
	 * checker of the program that holds the file. A file no tsconfig covers is
	 * simply absent — a rule reads what it was given and says nothing about the
	 * rest, which is the same way it degrades in a repo with no compiler at all.
	 */
	typedFiles: Map<string, { sourceFile: ts.SourceFile; checker: ts.TypeChecker }>;
	/** What each package declares it depends on, keyed by package root (`.` for the repo). A framework carve-out is keyed on what a package DECLARES, so a typed rule needs this to honour one. */
	dependencies: Map<string, string[]>;
	/** Repo-relative roots of the standards packs in the tree. Inside one, a `tests/` folder names a document set rather than a directory of tests — pass it to `isTestFile`. */
	standardsPacks: string[];
}

export interface TestFileInput {
	kind: typeof StandardsInputKind.TestFile;
	cwd: string;
	tests: string[];
	/** Text for every path in `tests`, from the run's shared content cache. */
	contents: Map<string, string>;
}

export interface ImportGraphInput {
	kind: typeof StandardsInputKind.ImportGraph;
	cwd: string;
	source: string[];
	tests: string[];
	files: string[];
	referenceFiles: string[];
	/** Edges as `collectImportEdges` resolves them: repo-relative from/to pairs. */
	edges: Array<{ from: string; to: string }>;
	/** What each package declares it depends on, keyed by package root (`.` for the repo). A framework carve-out is keyed on what a package DECLARES, so a boundary rule needs this to honour one — a module folder a framework mandates is not the rule's to judge. */
	dependencies: Map<string, string[]>;
	/** Repo-relative roots of the standards packs in the tree. Inside one, a `tests/` folder names a document set rather than a directory of tests — pass it to `isTestFile`. */
	standardsPacks: string[];
}

export interface CloneSpansInput {
	kind: typeof StandardsInputKind.CloneSpans;
	cwd: string;
	source: string[];
	spans: CloneSpan[];
}

/**
 * The inputs a check may declare, one interface per kind. A check never opens a
 * file: it says which shape it needs and the engine builds that shape once per
 * run from one shared content cache, so every file is read exactly once no
 * matter how many rules want it.
 *
 * The set is closed for now — a pack cannot ship its own reader.
 */
export type StandardsCheckInput = FileListInput | FileTextInput | SyntaxTreeInput | TypeCheckerInput | TestFileInput | ImportGraphInput | CloneSpansInput;
