// The repo's own gate commands — check, test, coverage, build — run against a
// scope and reported as evidence. Every kind of run needs them (implement,
// coverage, refactor), so they live beside those pipelines rather than inside
// one: coverage used to reach into `pipeline/` for them, and `pipeline/` reaches
// into `coverage/` for the executed-files check, which made importing either
// pull in the whole of the other.
//
// Building a schedule is part of calling `runGates`, so the names that describe
// one are published beside it, along with the mapping that turns a checkpoint's
// `gate-overrides` entry into a schedule — `runVerificationGates` and this
// module's own self-check must resolve the same entry the same way.
export { GateScheduleKind } from '#src/gates/common/constants/GateScheduleKind.ts';
// A value export, because the CLI that prints a self-check narrows on its
// members and keys its headline table by them.
export { SelfCheckReason } from '#src/gates/common/constants/SelfCheckReason.ts';
export type { GateRunResult } from '#src/gates/common/types/GateRunResult.ts';
export type { GateSchedule } from '#src/gates/common/types/GateSchedule.ts';
export type { SelfCheckResult } from '#src/gates/common/types/SelfCheckResult.ts';
// One entry per group and gate kind, so a re-run gate is reported once. Both
// callers of `runGates` that keep what it observed share this rather than
// spelling the key themselves.
export { collectGateObservations } from '#src/gates/common/utils/collectGateObservations.ts';
// The one spelling of a gate run that never started because the machine was
// taken. Published because a later caller emits it from outside this module,
// and two spellings of one event read as two different events.
export { describeGateCoordinationTimeout } from '#src/gates/common/utils/describeGateCoordinationTimeout.ts';
export { resolveGateSchedule } from '#src/gates/common/utils/resolveGateSchedule.ts';
// The durable hold a coordination failure takes on ticket-backed work, and the
// one predicate every refusal site shares. Published here so `queue/`,
// `ticketLifecycle/` and `pipeline/` never reach into this module's internals:
// the readers and writers beneath these five names stay private, because a
// caller that could read the holds without `syncGateHolds` could act on an
// unreconciled one.
export type { GateHolds } from '#src/gates/gateHolds/index.ts';
export { describeGateHold, gateBlockedLabel, isTicketGateHeld, syncGateHolds, takeGateHold } from '#src/gates/gateHolds/index.ts';
// The shared reservation that serialises whole gate runs across a repository's
// worktrees. `runGateSchedule` and `stageCountOf` stay internal: what a run
// schedules is this module's own business.
export type { GateLockOutcome } from '#src/gates/gateLock/index.ts';
export { withGateLock } from '#src/gates/gateLock/index.ts';
export { runBatchGates } from '#src/gates/runBatchGates.ts';
export { runGates } from '#src/gates/runGates.ts';
export { runSelfCheck } from '#src/gates/runSelfCheck.ts';
// The evidence half of acceptance testing: what a gate execution actually ran.
// `testResultsDir` and `writeJestReporter` are published by that module for the
// gate runner beside this barrel, and stop here — nothing outside the gates
// writes a reporter or names a results directory.
export { checkAcceptanceTests, checkTestResultsCapability, readTestResults } from '#src/gates/testResults/index.ts';
