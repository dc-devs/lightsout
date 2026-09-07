import type { GateOverride } from '#src/contracts/index.ts';
import { GateScheduleKind } from '#src/gates/common/constants/GateScheduleKind.ts';
import type { GateSchedule } from '#src/gates/common/types/GateSchedule.ts';

interface Params {
	/** The checkpoint's `gate-overrides` entry, as `resolveGateOverride` returns it. */
	override: GateOverride | undefined;
}

/**
 * A checkpoint's gate schedule: its `gate-overrides` entry when it has one, the
 * engine's two tiers when it does not.
 *
 * Shared rather than restated, because the checkpoint and the self-check that
 * precedes it must resolve the same schedule from the same entry — a second
 * three-branch mapping is how the two would come to disagree.
 */
export const resolveGateSchedule = ({ override }: Params): GateSchedule => {
	if (override === undefined) {
		return { kind: GateScheduleKind.Tiered };
	}

	return override === 'off' ? { kind: GateScheduleKind.Off } : { kind: GateScheduleKind.Exact, gates: override };
};
