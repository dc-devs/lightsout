import type { CommandResult } from '#src/common/types/CommandResult.ts';
import type { GateEnding } from '#src/gates/internal/common/constants/GateEnding.ts';

/**
 * What one gate execution came back with, plus the runner's one judgment about
 * the gate's last attempt: how it ended — passed, failed, crashed or timed out.
 *
 * The ending rides here instead of being re-derived downstream because the
 * runner is the only place that saw every attempt — a caller reading the last
 * attempt's output alone cannot tell an absorbed crash from an unabsorbed one,
 * nor a gate the ceiling stopped from one that failed to spawn.
 */
export interface GateOutcome extends CommandResult {
	ending: GateEnding;
	/** The ceiling each attempt ran under, in the minutes the operator configured. */
	ceilingMinutes: number;
}
