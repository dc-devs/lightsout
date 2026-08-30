export { appendCommandLog } from '#src/runState/appendCommandLog.ts';
export { appendFriction } from '#src/runState/appendFriction.ts';
export { appendReviewFindings } from '#src/runState/appendReviewFindings.ts';
export { getRunDir } from '#src/runState/common/paths/getRunDir.ts';
export { getRunsDir } from '#src/runState/common/paths/getRunsDir.ts';
export { resolveRunId } from '#src/runState/common/paths/resolveRunId.ts';
export type { RunSummary } from '#src/runState/common/types/RunSummary.ts';
export type { StepSummary } from '#src/runState/common/types/StepSummary.ts';
export { createRun } from '#src/runState/createRun.ts';
export { isPidAlive } from '#src/runState/isPidAlive.ts';
export { isRunLive } from '#src/runState/isRunLive.ts';
export { isRunPaused } from '#src/runState/isRunPaused.ts';
export { isRunResumable } from '#src/runState/isRunResumable.ts';
export { listRunIds } from '#src/runState/listRunIds.ts';
// acquireRunLock and releaseRunLock are deliberately NOT re-published here.
// `withRunLock` is their only caller and it releases what it acquires; offering
// the pair to the whole engine is an invitation to take a lock and forget it.
// Their own tests reach them through `runState/lock/index.ts`.
export { RunLockError, readRunLock, withRunLock } from '#src/runState/lock/index.ts';
export { createProgressSink, getProgressLogPath, readLastProgressMessage } from '#src/runState/progress/index.ts';
export { RunNotFoundError } from '#src/runState/RunNotFoundError.ts';
export { readFriction } from '#src/runState/readFriction.ts';
export { readReviewFindings } from '#src/runState/readReviewFindings.ts';
export { readRunManifest } from '#src/runState/readRunManifest.ts';
export { recordAgentUsage } from '#src/runState/recordAgentUsage.ts';
export { seedUsageTotals } from '#src/runState/seedUsageTotals.ts';
export { summarizeRun } from '#src/runState/summarizeRun.ts';
export { writeManifestWithUsage } from '#src/runState/writeManifestWithUsage.ts';
export { writeRunManifest } from '#src/runState/writeRunManifest.ts';
