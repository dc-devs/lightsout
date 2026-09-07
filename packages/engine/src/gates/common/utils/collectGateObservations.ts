import type { GateResult } from '#src/contracts/index.ts';

/**
 * The `onGateResult` sink a `runGates` caller hands over, paired with the list
 * it fills.
 *
 * The keying is the contract: one entry per group and gate kind, so a gate the
 * runner re-ran is reported once, by its last observation. Shared rather than
 * written out at each call site, because two callers spelling that key
 * themselves is how the two would come to disagree about it.
 */
export const collectGateObservations = (): { onGateResult: (gateResult: GateResult) => void; observed: () => GateResult[] } => {
	const observations = new Map<string, GateResult>();

	return {
		onGateResult: (gateResult) => observations.set(`${gateResult.group}\0${gateResult.kind}`, gateResult),
		observed: () => [...observations.values()],
	};
};
