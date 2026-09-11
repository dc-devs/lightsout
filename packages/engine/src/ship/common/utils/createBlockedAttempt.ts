import { type ShipBlockReason, ShipStatus } from '#src/contracts/index.ts';
import type { ShipAttemptResult } from '#src/ship/common/types/ShipAttemptResult.ts';
import type { ShipStopFields } from '#src/ship/common/types/ShipStopFields.ts';

interface Params {
	stop: ShipStopFields;
	reason: ShipBlockReason;
	detail: string;
	failingChecks?: string[];
	retryable?: boolean;
	ciEvidence?: string;
}

/** A proposal, never a persisted result: `runShip` alone decides which attempt's outcome becomes the record. */
export const createBlockedAttempt = ({ stop, reason, detail, failingChecks = [], retryable = false, ciEvidence }: Params): ShipAttemptResult => ({
	result: { status: ShipStatus.Blocked, failingChecks, ...stop, reason, detail },
	retryable,
	ciEvidence,
});
