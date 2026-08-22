import { isTestFile } from '#src/common/sourceFiles/isTestFile.ts';
import { standardsScopeFiles } from '#src/pipeline/common/utils/standardsScopeFiles.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

interface Params {
	run: PipelineRun;
}

/**
 * The run's changed files that earn agent attention: source this repo owns,
 * never tests.
 *
 * One filter on top of `standardsScopeFiles` rather than its own copy of the
 * same conditions — the two lists differ by exactly this, and stating the
 * difference in one place is what keeps them from drifting.
 *
 * Dropping tests is right for every caller here: a test writer must not be
 * handed a test as a subject, and a refactor pass reviews the code rather than
 * the suite pinning it. It is wrong for the standards gate, which is why that
 * gate reads the wider list directly.
 *
 * Vendored code is already gone by this point. It is a real change worth
 * recording in the manifest — the attribution keeps it — but it is not this
 * repo's code to restructure, and nobody writes tests for it.
 */
export const sourceFiles = ({ run }: Params): string[] => standardsScopeFiles({ run }).filter((file) => !isTestFile({ path: file }));
