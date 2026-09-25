import { basename, relative } from 'node:path';
import type { ActivityLevel } from '#src/activity/common/types/ActivityLevel.ts';
import { buildPlanFindingRecheckInvocation } from '#src/agents/buildPlanFindingRecheckInvocation.ts';
import type { Effort } from '#src/contracts/Effort.ts';
import type { Permissions } from '#src/contracts/Permissions.ts';
import type { GapObservation } from '#src/contracts/plan/grade/GapObservation.ts';
import { GapVerdict } from '#src/contracts/plan/grade/GapVerdict.ts';
import type { GradeFindingRecord } from '#src/contracts/plan/memory/GradeFindingRecord.ts';
import { GradeFindingStatus } from '#src/contracts/plan/memory/GradeFindingStatus.ts';
import type { GradeMemory } from '#src/contracts/plan/memory/GradeMemory.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import { planAgentConcurrency } from '#src/plan/common/constants/planAgentConcurrency.ts';
import { recheckPlanText } from '#src/plan/common/memory/recheckPlanText.ts';
import { recordObservations } from '#src/plan/common/memory/recordObservations.ts';
import { settleRecheckedRecord } from '#src/plan/common/memory/settleRecheckedRecord.ts';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';
import { createPlanAgentRunner } from '#src/plan/common/utils/createPlanAgentRunner.ts';
import { drainTasks } from '#src/plan/common/utils/drainTasks.ts';
import { findingLocations } from '#src/plan/common/utils/findingLocations.ts';
import { isRateLimited } from '#src/plan/common/utils/isRateLimited.ts';

/** One open record at one of its locations, paired with the current text of that location — the same text both the judge and the citation check read. */
interface RecheckPair {
	record: GradeFindingRecord;
	/** The plan file this spawn asks about. */
	location: string;
	/** Every plan file the record spans, in first-appearance order. */
	locations: string[];
	/** The record's observation at this location, in its own reader's words. */
	observation: GapObservation;
	planText: string;
}

interface Params {
	cwd: string;
	driver: Driver;
	/** The plan's workspace — where each judge's transcript lands, and the folder the sibling phase files sit in. */
	workspaceDir: string;
	/** Overview text for a phased plan: context the judge reads, never judged standalone. */
	overviewText?: string;
	standards?: string;
	model?: string;
	effort?: Effort;
	permissions?: Permissions;
	timeoutMs?: number;
	/** Every plan file with its current text — each of a record's locations is looked up here. */
	files: DeliverableFile[];
	memory: GradeMemory;
	/** The pass timestamp written into each of a closed record's `resolutions`. */
	at: string;
	/** Set when the caller already hit the rate-limit wall: nothing is spawned and every record stays open. */
	skipReason?: string;
	/** The plan-file basenames whose read coverage fell this pass — the SAME answer the reader selection narrowed by, never a second closure computed here. */
	invalidated: string[];
	/** The pass level each re-verification spawn opens its step under — substituted for the command run's own before the caller spreads its params in here. */
	level?: ActivityLevel;
}

/** The plan files one record touches, in first-appearance order — read once and used both to decide whether to ask and to build the spawns. */
const locationsOf = ({ record }: { record: GradeFindingRecord }) => findingLocations({ observations: recordObservations({ record }), phase: record.phase });

/** One pair per location of an open record, each carrying the first observation made there and that location's own plan text. */
const recheckPairs = ({
	record,
	locations,
	files,
	overviewText,
}: {
	record: GradeFindingRecord;
	locations: string[];
	files: DeliverableFile[];
	overviewText?: string;
}): RecheckPair[] => {
	const observations = recordObservations({ record });

	return locations.map((location) => ({
		record,
		location,
		locations,
		observation: observations.filter((observation) => observation.phase === location)[0],
		planText: recheckPlanText({ files, overviewText, phase: location }),
	}));
};

/**
 * Whether one record is worth a judge this pass: a record no judge has ever
 * answered is always asked, and one that has been answered is asked again only
 * where a location of it lost its reading.
 *
 * A location that is not one of the deliverable's current plan files — the
 * overview a documentation finding is stamped with, or a phase file a resplit
 * renamed away — counts as lost whatever `invalidated` holds. No coverage is
 * recorded for such a location, so nothing can say it still stands; stamped
 * once, the record would block approval forever even after the plan was
 * repaired. It is not a second reach rule but the statement that a file the one
 * rule cannot speak for is never treated as covered.
 */
const isWorthAsking = ({
	record,
	locations,
	invalidated,
	planFiles,
}: {
	record: GradeFindingRecord;
	locations: string[];
	invalidated: string[];
	planFiles: string[];
}) => record.lastRecheckedAt === undefined || locations.some((location) => invalidated.includes(location) || !planFiles.includes(location));

/** One re-verification spawn: its own runner and its own transcript, because a sink shared by a dozen judges — or by one record's several locations — interleaves into one unreadable file. */
const spawnRecheck = async ({ params, pair }: { params: Params; pair: RecheckPair }) => {
	// Ten minutes, the judges' number rather than the readers' thirty: a
	// re-verification judge that never answers leaves its record open, which
	// blocks, so its failure costs one extra question rather than a lost pass.
	const { cwd, driver, workspaceDir, overviewText, standards, model, effort, permissions, timeoutMs = 10 * 60 * 1000, level } = params;
	const invokePlanAgent = createPlanAgentRunner({
		cwd,
		driver,
		workspaceDir,
		step: `grade-recheck-${pair.record.id}-${basename(pair.location, '.md')}`,
		level,
		model,
		effort,
		permissions,
		timeoutMs,
	});
	const outcome = await invokePlanAgent({
		invocation: buildPlanFindingRecheckInvocation({
			planText: pair.planText,
			overviewText,
			standards,
			// Only a phased plan has siblings to point at, and a record raised
			// against one phase may now be answered in another.
			planDir: overviewText === undefined ? undefined : relative(cwd, workspaceDir),
			record: pair.record,
			observation: pair.observation,
			locations: pair.locations,
		}),
		contract: GapVerdict,
	});

	return { outcome };
};

/**
 * Ask, once per location of every open record, whether the plan now states the
 * answer there.
 *
 * This is the only path that closes a record. A later reader's silence is not
 * evidence — the question it stopped reporting may simply not have come up
 * again — so an unanswered record keeps blocking until a judge points at where
 * the plan settles it AND the engine confirms that citation. A record spanning
 * several plan files is asked once per file, each judge given that file's own
 * text and that location's own wording, and it closes only when every location
 * is confirmed: fixing one occurrence never closes the others.
 *
 * Only `open` records are asked. A `pending` record needs judging rather than
 * re-verification, and a `superseded` one's question lives on its survivor.
 *
 * Nor is every open record asked every pass. A record is asked when no
 * re-verification judge has ever answered about it, and afterwards only when one
 * of its locations lost its read coverage — the same invalidation the reader
 * selection narrowed by, because two reach rules that can disagree are exactly
 * what one reach rule exists to avoid. A record that keeps its coverage and
 * carries a stamp is not asked and therefore not closed: it stays open and keeps
 * blocking, which is the safe direction and needs no state of its own.
 *
 * The text a location is asked against is its own plan file, or the whole plan
 * when it names no deliverable file — see `recheckPlanText`.
 */
export const verifyOpenFindings = async (params: Params): Promise<{ memory: GradeMemory; rateLimited: boolean; refusals: Map<string, string> }> => {
	const { cwd, files, overviewText, memory, at, skipReason, invalidated } = params;
	const planFiles = files.map((file) => basename(file.path));
	const located = memory.findings
		.filter((record) => record.status === GradeFindingStatus.Open)
		.map((record) => ({ record, locations: locationsOf({ record }) }));
	// A wall met by launching another dozen spawns into it is still a wall, so a
	// skipped pass asks nothing and every record simply stays open.
	const worth = skipReason === undefined ? located.filter((entry) => isWorthAsking({ ...entry, invalidated, planFiles })) : [];
	const asked = worth.map(({ record }) => record);
	const pairs = worth.flatMap(({ record, locations }) => recheckPairs({ record, locations, files, overviewText }));
	const results = await drainTasks({
		tasks: pairs.map((pair) => () => spawnRecheck({ params, pair })),
		concurrency: planAgentConcurrency,
		shouldStop: ({ results: settled }) => settled.some((result) => isRateLimited({ result })),
	});
	const settled = new Map<string, GradeFindingRecord>();
	const refusals = new Map<string, string>();

	for (const record of asked) {
		const answers = pairs.flatMap((pair, slot) =>
			pair.record === record ? [{ location: pair.location, planText: pair.planText, outcome: results[slot]?.outcome }] : [],
		);
		const { record: next, refusal } = await settleRecheckedRecord({ cwd, record, located: answers, at });

		settled.set(record.id, next);

		if (refusal !== undefined) {
			refusals.set(record.id, refusal);
		}
	}

	return {
		memory: { ...memory, findings: memory.findings.map((record) => settled.get(record.id) ?? record) },
		rateLimited: results.some((result) => isRateLimited({ result })),
		refusals,
	};
};
