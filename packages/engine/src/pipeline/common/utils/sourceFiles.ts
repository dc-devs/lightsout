import { isTestFile } from '../../../common/utils/isTestFile';
import type { PipelineRun } from '../../PipelineRun';

interface Params {
	run: PipelineRun;
}

/**
 * Only the JS/TS family earns agent turns (test writers, refactor review) —
 * every spawn costs a model call, so unknown file types default to zero
 * wasted turns. Allowlist: .js/.jsx/.ts/.tsx plus the m/c module variants.
 */
const isTestableSourceFile = (path: string) => /\.(m|c)?[jt]sx?$/i.test(path);

/** The run's changed files that earn agent attention: testable source, never tests. */
export const sourceFiles = ({ run }: Params): string[] =>
	run.current().changedFiles.filter((file) => !isTestFile(file) && isTestableSourceFile(file));
