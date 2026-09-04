// The repo's own gate commands — check, test, coverage, build — run against a
// scope and reported as evidence. Every kind of run needs them (implement,
// coverage, refactor), so they live beside those pipelines rather than inside
// one: coverage used to reach into `pipeline/` for them, and `pipeline/` reaches
// into `coverage/` for the executed-files check, which made importing either
// pull in the whole of the other.
//
// Building a schedule is part of calling `runGates`, so the two names that
// describe one are published beside it. `GateScheduleKind` is a value export
// rather than a type-only one: `runVerificationGates` names its members.
export { GateScheduleKind } from '#src/gates/common/constants/GateScheduleKind.ts';
export type { GateRunResult } from '#src/gates/common/types/GateRunResult.ts';
export type { GateSchedule } from '#src/gates/common/types/GateSchedule.ts';
export { runBatchGates } from '#src/gates/runBatchGates.ts';
export { runGates } from '#src/gates/runGates.ts';
