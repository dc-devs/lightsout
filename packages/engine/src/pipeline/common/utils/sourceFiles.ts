import { isTestFile } from '../../../common/utils/isTestFile';
import { isTestableSourceFile } from '../../../common/utils/isTestableSourceFile';
import type { PipelineRun } from '../../PipelineRun';

interface Params {
	run: PipelineRun;
}

/** The run's changed files that earn agent attention: testable source, never tests. */
export const sourceFiles = ({ run }: Params): string[] =>
	run.current().changedFiles.filter((file) => !isTestFile(file) && isTestableSourceFile(file));
