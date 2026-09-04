import type { GateScheduleKind } from '#src/gates/common/constants/GateScheduleKind.ts';

/**
 * How one gate run is scheduled. Four kinds, because only the verification
 * checkpoints want tiering and every other gate caller must keep running
 * exactly as it does today.
 */
export type GateSchedule =
	| { kind: typeof GateScheduleKind.Single }
	| { kind: typeof GateScheduleKind.Tiered }
	| { kind: typeof GateScheduleKind.Exact; gates: string[] }
	| { kind: typeof GateScheduleKind.Off };
