import type ts from 'typescript';
import { StandardsInputKind, type StandardsCheckInput } from '@/contracts';
import { buildCloneSpansInput } from '@/standardsCheck/common/checkInputs/buildCloneSpansInput';
import { buildFileListInput } from '@/standardsCheck/common/checkInputs/buildFileListInput';
import { buildFileTextInput } from '@/standardsCheck/common/checkInputs/buildFileTextInput';
import { buildImportGraphInput } from '@/standardsCheck/common/checkInputs/buildImportGraphInput';
import { buildSyntaxTreeInput } from '@/standardsCheck/common/checkInputs/buildSyntaxTreeInput';
import { buildTestFileInput } from '@/standardsCheck/common/checkInputs/buildTestFileInput';

interface Params {
	/** Which shape to build — the kind a rule's check declared. */
	kind: StandardsInputKind;
	cwd: string;
	source: string[];
	tests: string[];
	files: string[];
	referenceFiles: string[];
	/** Monorepo package parent dir — only the file-list kind reads it. */
	packagesDir: string;
	/** The asking rule's resolved numbers — only the clone-spans detector reads them. */
	settings: Record<string, number>;
	/** The run's shared content cache — every text-carrying kind draws from it. */
	cache: Map<string, string>;
	/** The consumer's TypeScript, when it resolved. */
	compiler?: typeof ts;
}

/**
 * Build one check input by kind — the single place the closed set of input
 * kinds turns into data. Both callers that execute package checks (the run and
 * the fixture validation) come through here, so a rule is handed exactly the
 * same shape whether it is checking a repo or its own fixtures.
 *
 * @param kind - the input kind the rule's check declared
 * @throws {Error} When the kind needs TypeScript and none was resolved — callers skip such rules with a note instead.
 */
export const buildCheckInput = async ({
	kind,
	cwd,
	source,
	tests,
	files,
	referenceFiles,
	packagesDir,
	settings,
	cache,
	compiler,
}: Params): Promise<StandardsCheckInput> => {
	switch (kind) {
		case StandardsInputKind.FileList:
			return buildFileListInput({ cwd, source, tests, files, referenceFiles, packagesDir });

		case StandardsInputKind.FileText:
			return buildFileTextInput({ cwd, source, tests, files, referenceFiles, cache });

		case StandardsInputKind.TestFile:
			return buildTestFileInput({ cwd, tests, cache });

		case StandardsInputKind.CloneSpans:
			return buildCloneSpansInput({ cwd, source, settings, cache });

		case StandardsInputKind.SyntaxTree:
		case StandardsInputKind.ImportGraph: {
			if (compiler === undefined) {
				throw new Error(`the ${kind} input needs the consumer's typescript, which did not resolve`);
			}

			if (kind === StandardsInputKind.ImportGraph) {
				return buildImportGraphInput({ cwd, source, tests, files, referenceFiles, compiler });
			}

			return buildSyntaxTreeInput({ cwd, source, tests, files, referenceFiles, compiler, cache });
		}
	}
};
