import type { ShipResult } from '#src/contracts/index.ts';

/** One complete shipping attempt's proposed outcome, before the outer loop decides whether to persist it or spend another attempt. */
export interface ShipAttemptResult {
	/** The result this attempt would leave behind, were it the last one. */
	result: ShipResult;
	/** True only for a confirmed stale-base refusal or readable failed-CI evidence awaiting the next scoped repair. A shipped result is never retryable. */
	retryable: boolean;
	/** The failing run's own output, when the next attempt is meant to repair a demonstrated CI defect. */
	ciEvidence?: string;
}
