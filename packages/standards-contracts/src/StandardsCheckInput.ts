import type ts from 'typescript';
import type { CloneSpan } from './CloneSpan.ts';
import type { StandardsInputKind } from './StandardsInputKind.ts';

/**
 * The inputs a check may declare, one interface per kind. A check never opens a
 * file: it says which shape it needs and the engine builds that shape once per
 * run from one shared content cache, so every file is read exactly once no
 * matter how many rules want it.
 *
 * The set is closed for now — a package cannot ship its own reader.
 */
export interface FileListInput {
	kind: typeof StandardsInputKind.FileList;
	cwd: string;
	source: string[];
	tests: string[];
	files: string[];
	referenceFiles: string[];
	/** Declared dependency names per package dir ('.' for the repo root) — engine-read from each package.json. */
	dependencies: Map<string, string[]>;
	/** Repo-relative roots of the standards packages in the tree. Inside one, a `tests/` folder names a document set rather than a directory of tests — pass it to `isTestFile`. */
	standardsPackages: string[];
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
	 * sitting above one of them, when present; each file read once for the whole
	 * run.
	 *
	 * Every tsconfig, not just the root's, because path aliases are declared per
	 * package — a rule resolving one file's imports must read the nearest config
	 * above THAT file, not the workspace's.
	 */
	contents: Map<string, string>;
	/** Repo-relative roots of the standards packages in the tree. Inside one, a `tests/` folder names a document set rather than a directory of tests — pass it to `isTestFile`. */
	standardsPackages: string[];
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
	/** Repo-relative roots of the standards packages in the tree. Inside one, a `tests/` folder names a document set rather than a directory of tests — pass it to `isTestFile`. */
	standardsPackages: string[];
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
	/** Repo-relative roots of the standards packages in the tree. Inside one, a `tests/` folder names a document set rather than a directory of tests — pass it to `isTestFile`. */
	standardsPackages: string[];
}

export interface CloneSpansInput {
	kind: typeof StandardsInputKind.CloneSpans;
	cwd: string;
	source: string[];
	spans: CloneSpan[];
}

export type StandardsCheckInput = FileListInput | FileTextInput | SyntaxTreeInput | TestFileInput | ImportGraphInput | CloneSpansInput;
