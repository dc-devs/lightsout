// Every file below carries its own tests, which under the test standards is a
// promotion rather than an exception: a directly-tested file is published by
// its module's barrel.

export { buildCoverageBatch } from '#src/coverage/buildCoverageBatch.ts';
export type { CoverageResult } from '#src/coverage/CoverageResult.ts';
export { checkChangedFilesExecuted } from '#src/coverage/checkChangedFilesExecuted.ts';
export { initializeCoverageRun } from '#src/coverage/initializeCoverageRun.ts';
export { resolveCoverageScopes } from '#src/coverage/resolveCoverageScopes.ts';
export { runCoverageCheck } from '#src/coverage/runCoverageCheck.ts';
export { runCoveragePipeline } from '#src/coverage/runCoveragePipeline.ts';
export { seedCoverageResumeState } from '#src/coverage/seedCoverageResumeState.ts';
export { selectCollectedFiles } from '#src/coverage/selectCollectedFiles/index.ts';
export { selectCoverageCandidates } from '#src/coverage/selectCoverageCandidates.ts';
export { selectUnloadableFiles } from '#src/coverage/selectUnloadableFiles/index.ts';
