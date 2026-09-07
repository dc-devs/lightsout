import { GateTier } from '#src/gates/common/constants/GateTier.ts';
import type { GateEntry } from '#src/gates/common/types/GateEntry.ts';
import type { GateSchedule } from '#src/gates/common/types/GateSchedule.ts';
import { buildGateStages } from '#src/gates/common/utils/buildGateStages.ts';
import { gateTierOf } from '#src/gates/common/utils/gateTierOf.ts';

interface Params {
	/** The group's configured entries, as `buildGateEntries` produces them. */
	entries: GateEntry[];
	/** The schedule the checkpoint this self-check precedes would run. */
	schedule: GateSchedule;
	/** Whether the coverage gate can give a true answer at this step. */
	coverage?: boolean;
}

/**
 * The gate names one self-check runs, derived from the schedule the following
 * checkpoint would use rather than listed a second time.
 *
 * The cheap gates plus the build: the agent sees the failures it is about to be
 * judged on without the run paying for the slow suites twice. Every custom
 * `test-*` suite is expensive and is not the build, so it falls out without a
 * rule of its own.
 *
 * The coverage answer is applied here rather than trusted to `buildGateStages`,
 * which ignores its `coverage` argument for an `exact` schedule and would
 * otherwise run coverage at the implement step for a repo that pinned that
 * checkpoint to a list naming it. At implement the freshly written source has no
 * tests yet, so coverage is red by construction and the executor is not the role
 * that fixes it. The pinned list still decides which gates exist; the step still
 * decides whether coverage is one of them.
 */
export const selfCheckGateNames = ({ entries, schedule, coverage }: Params): string[] =>
	buildGateStages({ entries, schedule, coverage })
		.flat()
		.filter((entry) => gateTierOf({ family: entry.family }) === GateTier.Cheap || entry.family === 'build')
		.filter((entry) => coverage === true || entry.name !== 'test-coverage')
		.map((entry) => entry.name);
