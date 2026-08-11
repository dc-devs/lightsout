import { isTestableSourceFile } from '@/common/utils/isTestableSourceFile';
import { isTestFile } from '@/common/utils/isTestFile';
import type { PipelineRun } from '@/pipeline/PipelineRun';

interface Params {
	run: PipelineRun;
}

/** The run's changed files that earn agent attention: testable source, never tests. */
export const sourceFiles = ({ run }: Params): string[] =>
	run.current().changedFiles.filter((file) => !isTestFile({ path: file }) && isTestableSourceFile(file));
