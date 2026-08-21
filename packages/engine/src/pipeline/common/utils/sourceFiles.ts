import { isTestableSourceFile } from '#src/common/sourceFiles/isTestableSourceFile.ts';
import { isTestFile } from '#src/common/sourceFiles/isTestFile.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

interface Params {
	run: PipelineRun;
}

/** The run's changed files that earn agent attention: testable source, never tests. */
export const sourceFiles = ({ run }: Params): string[] =>
	run.current().changedFiles.filter((file) => !isTestFile({ path: file }) && isTestableSourceFile({ path: file }));
