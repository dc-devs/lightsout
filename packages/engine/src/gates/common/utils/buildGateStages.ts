import { GateScheduleKind } from '#src/gates/common/constants/GateScheduleKind.ts';
import { GateTier } from '#src/gates/common/constants/GateTier.ts';
import type { GateEntry } from '#src/gates/common/types/GateEntry.ts';
import type { GateSchedule } from '#src/gates/common/types/GateSchedule.ts';
import { gateTierOf } from '#src/gates/common/utils/gateTierOf.ts';

/**
 * This group's entries in the order an override list named them.
 *
 * Selection runs over the group's own entries rather than over the list, so one
 * entry can never appear twice, and a name this group has no entry for
 * contributes nothing rather than failing the group.
 */
const selectNamed = ({ entries, gates }: { entries: GateEntry[]; gates: string[] }) => gates.flatMap((name) => entries.filter((entry) => entry.name === name));

/**
 * The default schedule's entries: the coverage gate only when the caller asked
 * for it, and never beside the plain unit suite — a coverage command runs the
 * same tests instrumented, so scheduling both is the same fleet twice.
 */
const selectDefault = ({ entries, coverage }: { entries: GateEntry[]; coverage?: boolean }) => {
	const scheduled = entries.filter((entry) => entry.name !== 'test-coverage' || coverage === true);
	const instrumented = scheduled.some((entry) => entry.name === 'test-coverage');

	return scheduled.filter((entry) => entry.name !== 'test' || !instrumented);
};

/** The entries of one tier, in the canonical order they already carry. */
const inTier = ({ entries, tier }: { entries: GateEntry[]; tier: GateTier }) => entries.filter((entry) => gateTierOf({ family: entry.family }) === tier);

interface Params {
	entries: GateEntry[];
	schedule: GateSchedule;
	/** Whether the caller asked for the coverage gate. Ignored by `exact`, which names its gates itself. */
	coverage?: boolean;
}

/**
 * A run's schedule for one group: the ordered lists to run one after another,
 * where the boundary between two lists is where every group in scope waits.
 *
 * This is the single place deciding whether the coverage gate is scheduled.
 * `runGates` builds an entry for every command the config configures, and the
 * decision lives beside the `coverage` argument rather than being made twice
 * and kept in step by hand.
 */
export const buildGateStages = ({ entries, schedule, coverage }: Params): GateEntry[][] => {
	if (schedule.kind === GateScheduleKind.Off) {
		return [];
	}

	if (schedule.kind === GateScheduleKind.Exact) {
		return [selectNamed({ entries, gates: schedule.gates })];
	}

	const scheduled = selectDefault({ entries, coverage });

	return schedule.kind === GateScheduleKind.Tiered
		? [inTier({ entries: scheduled, tier: GateTier.Cheap }), inTier({ entries: scheduled, tier: GateTier.Expensive })]
		: [scheduled];
};
