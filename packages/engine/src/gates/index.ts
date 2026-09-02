// The repo's own gate commands — check, test, coverage, build — run against a
// scope and reported as evidence. Every kind of run needs them (implement,
// coverage, refactor), so they live beside those pipelines rather than inside
// one: coverage used to reach into `pipeline/` for them, and `pipeline/` reaches
// into `coverage/` for the executed-files check, which made importing either
// pull in the whole of the other.
export type { GateRunResult } from '#src/gates/common/types/GateRunResult.ts';
export { runBatchGates } from '#src/gates/runBatchGates.ts';
export { runGates } from '#src/gates/runGates.ts';
