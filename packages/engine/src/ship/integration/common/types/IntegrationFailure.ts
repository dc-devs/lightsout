import type { ShipBlockReason } from '#src/contracts/index.ts';

/** What the integration step hands back when it could not leave the branch ready to push. */
export interface IntegrationFailure {
	reason: ShipBlockReason;
	detail: string;
	/** Conflicted paths, or the gate families that stayed red — whichever ended the recovery. Empty when neither applies. */
	paths: string[];
}
