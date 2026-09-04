import type { CommandResult } from '#src/common/types/CommandResult.ts';

/**
 * What one gate execution came back with, plus the single judgment the gate
 * runner makes about a red: whether it is a known worker crash rather than
 * evidence about the code.
 *
 * The flag rides here instead of being re-derived downstream because the
 * runner is the only place that saw every attempt — a caller reading the last
 * attempt's output alone cannot tell an absorbed crash from an unabsorbed one.
 */
export interface GateOutcome extends CommandResult {
	/** Present (always `true`) when every attempt died in the known jest worker crash, with no failing test beside it. */
	crashed?: true;
}
