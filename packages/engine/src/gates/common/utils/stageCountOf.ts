import { GateScheduleKind } from '#src/gates/common/constants/GateScheduleKind.ts';
import type { GateSchedule } from '#src/gates/common/types/GateSchedule.ts';

/** How many stages each schedule runs — the tier boundary is the one place a run has more than one. */
const stageCounts: Record<GateScheduleKind, number> = {
	[GateScheduleKind.Single]: 1,
	[GateScheduleKind.Tiered]: 2,
	[GateScheduleKind.Exact]: 1,
	[GateScheduleKind.Off]: 0,
};

interface Params {
	schedule: GateSchedule;
}

/**
 * How many stages this schedule runs.
 *
 * Shared by the two callers that need it for different reasons: `runGates` asks
 * before it decides whether to reserve the machine at all — a schedule with no
 * stage runs no codegen command either, so there is nothing to serialise — and
 * `runGateSchedule` asks in order to run them. The exhaustive record is the
 * point: a new schedule kind fails to compile until its count is stated.
 */
export const stageCountOf = ({ schedule }: Params): number => stageCounts[schedule.kind];
