// Every file below carries its own tests, which under the test standards is a
// promotion rather than an exception: a directly-tested file is published by
// its module's barrel. This folder was invisible to the standards check until
// the walk stopped skipping every directory named `coverage`, which is why the
// list arrived all at once.

export { buildCoverageBatch } from '#src/coverage/buildCoverageBatch.ts';
export type { CoverageResult } from '#src/coverage/CoverageResult.ts';
export { checkChangedFilesExecuted } from '#src/coverage/checkChangedFilesExecuted.ts';
export { initializeCoverageRun } from '#src/coverage/initializeCoverageRun.ts';
export { invokeCoverageAgent } from '#src/coverage/invokeCoverageAgent.ts';
export { resolveCoverageScopes } from '#src/coverage/resolveCoverageScopes.ts';
export { runCoverageBatch } from '#src/coverage/runCoverageBatch.ts';
export { runCoverageCheck } from '#src/coverage/runCoverageCheck.ts';
export { runCoveragePipeline } from '#src/coverage/runCoveragePipeline.ts';
export { seedCoverageResumeState } from '#src/coverage/seedCoverageResumeState.ts';
export { selectCoverageCandidates } from '#src/coverage/selectCoverageCandidates.ts';
