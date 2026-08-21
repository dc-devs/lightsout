import type { SettleKind } from '#src/refactor/batch/common/constants/SettleKind.ts';

/**
 * How a batch's verify ended, before the batch loop maps it onto a stop.
 *
 * One union for both the gate settle and the supervisor consult: they answer
 * the same question — is this batch green, out of budget, or a human's call —
 * and the loop reads them through the same three branches. Declared twice, the
 * two would agree today and drift by the time a fourth outcome appears.
 */
export type SettleOutcome = { kind: typeof SettleKind.Green } | { kind: typeof SettleKind.Parked } | { kind: typeof SettleKind.Escalated; error: string };
