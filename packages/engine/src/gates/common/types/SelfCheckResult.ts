import type { GateResult } from '#src/contracts/index.ts';
import type { SelfCheckReason } from '#src/gates/common/constants/SelfCheckReason.ts';

/** What one self-check ended with: why it ended, what it scheduled, and — for a run that reached the gates — what they found. */
export interface SelfCheckResult {
	reason: SelfCheckReason;
	gateNames: string[];
	gates: GateResult[];
	error: string | undefined;
	crashes: string[];
	/**
	 * Why the machine was never available — who held it, in which worktree, and
	 * for how long. Set only with `SelfCheckReason.Coordination`, and empty on
	 * every other ending.
	 *
	 * Required-but-possibly-undefined rather than optional, for the same reason
	 * the channel on `GateRunResult` is: the compiler then finds every literal
	 * that builds one of these instead of letting one silently inherit a missing
	 * member.
	 */
	coordination: string | undefined;
}
