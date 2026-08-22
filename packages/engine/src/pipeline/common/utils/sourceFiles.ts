import { isTestableSourceFile } from '#src/common/sourceFiles/isTestableSourceFile.ts';
import { isTestFile } from '#src/common/sourceFiles/isTestFile.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

interface Params {
	run: PipelineRun;
}

/**
 * The run's changed files that earn agent attention: testable source, never
 * tests, never vendored third-party code.
 *
 * Vendored paths are dropped HERE rather than from the changed-file list
 * itself, and the split is the whole point. Editing a vendored file is a real
 * change that belongs in the manifest and the report — the attribution keeps
 * it. What it must not do is enter an agent's work: it is not this repo's code
 * to restructure, its conventions are not this repo's standards, and nobody
 * writes tests for it. Every agent-facing use of the changed-file list runs
 * through this function, so one filter covers the refactor work-list, the
 * standards review, the test targets, and the coverage gate alike.
 */
export const sourceFiles = ({ run }: Params): string[] => {
	const vendored = run.config.vendored ?? [];

	return run
		.current()
		.changedFiles.filter((file) => !isTestFile({ path: file }) && isTestableSourceFile({ path: file }) && !vendored.some((prefix) => file.startsWith(prefix)));
};
