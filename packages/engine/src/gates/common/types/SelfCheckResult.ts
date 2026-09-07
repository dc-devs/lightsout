import type { GateResult } from '#src/contracts/index.ts';
import type { SelfCheckReason } from '#src/gates/common/constants/SelfCheckReason.ts';

/** What one self-check ended with: why it ended, what it scheduled, and — for a run that reached the gates — what they found. */
export interface SelfCheckResult {
	reason: SelfCheckReason;
	gateNames: string[];
	gates: GateResult[];
	error: string | undefined;
	crashes: string[];
}
