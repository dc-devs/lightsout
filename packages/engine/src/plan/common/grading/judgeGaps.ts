import { relative } from 'node:path';
import { buildPlanGapJudgeInvocation } from '#src/agents/index.ts';
import { type Effort, GapBatchVerdict, type GradedGap, GradeFindingStatus, type GradeMemory, type Permissions } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { planAgentConcurrency } from '#src/plan/common/constants/planAgentConcurrency.ts';
import { groupGapCandidates } from '#src/plan/common/grading/groupGapCandidates.ts';
import { matchGapVerdicts } from '#src/plan/common/grading/matchGapVerdicts.ts';
import { phaseFindingRecords } from '#src/plan/common/memory/phaseFindingRecords.ts';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';
import type { GapBatch } from '#src/plan/common/types/GapBatch.ts';
import { createPlanAgentRunner } from '#src/plan/common/utils/createPlanAgentRunner.ts';
import { drainTasks } from '#src/plan/common/utils/drainTasks.ts';
import { isRateLimited } from '#src/plan/common/utils/isRateLimited.ts';

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
	/** Every plan file the deliverable holds, with its current text — a carried pending record may name a file this pass's readers were never offered. */
	files: DeliverableFile[];
	/** The readers' findings plus the pending records carried forward, every one stamped `unjudged` until a judge rules. */
	gaps: GradedGap[];
	/** Set when the reader fan-out already hit the rate-limit wall: no judge is spawned and every finding keeps this as its reason. */
	skipReason?: string;
	/** The plan's finding memory — each judge is shown the records for the plan files its batch spans, and only ids a judge may be shown may be named. */
	memory: GradeMemory;
}

/** Every record state a judge may be shown and name — all but `superseded`, whose question now lives on the record that absorbed it. */
const judgeableStatuses: GradeFindingStatus[] = Object.values(GradeFindingStatus).filter((status) => status !== GradeFindingStatus.Superseded);

/**
 * The records for every plan file a batch spans, each listed once: a grouped
 * record is returned for each of its locations, and a judge shown it twice would
 * read one question as two.
 */
const batchRecords = ({ memory, batch }: { memory: GradeMemory; batch: GapBatch }) => [
	...new Map(
		batch.planTexts.flatMap(({ phase }) => phaseFindingRecords({ memory, phase, statuses: judgeableStatuses })).map((record) => [record.id, record]),
	).values(),
];

/** One judge spawn: its own runner and its own transcript, because a sink shared by a dozen judges interleaves into one unreadable file. */
const spawnGapJudge = async ({ params, batch, batchIndex }: { params: Params; batch: GapBatch; batchIndex: number }) => {
	// Ten minutes, not the readers' thirty: a judge is the one plan agent whose
	// failure is cheap — a timed-out judge leaves its findings `unjudged`, which
	// blocks, so it costs one extra question rather than a lost pass, while a hung
	// judge holding a slot for half an hour stalls the whole fan-out. Not five: a
	// reader takes about three minutes for more work, so ten fires only on
	// something genuinely stuck.
	const { cwd, driver, workspaceDir, overviewText, standards, model, effort, permissions, timeoutMs = 10 * 60 * 1000 } = params;
	const invokePlanAgent = createPlanAgentRunner({
		cwd,
		driver,
		workspaceDir,
		// Numbered by batch rather than named by phase, because a batch may span
		// several plan files.
		step: `grade-judge-${batchIndex}`,
		model,
		effort,
		permissions,
		timeoutMs,
	});
	const outcome = await invokePlanAgent({
		invocation: buildPlanGapJudgeInvocation({
			planTexts: batch.planTexts,
			overviewText,
			standards,
			// Only a phased plan has siblings to point at, and the judge opens one
			// itself when an observation is about a seam its batch does not span.
			planDir: overviewText === undefined ? undefined : relative(cwd, workspaceDir),
			records: batchRecords({ memory: params.memory, batch }),
			observations: batch.observations.map(({ id, gap }) => ({ id, observation: gap })),
		}),
		contract: GapBatchVerdict,
	});

	return { outcome };
};

/**
 * Weigh every finding: one judge per candidate batch, all at once, then the join.
 *
 * `groupGapCandidates` assembles the batches deterministically, with no agent,
 * from shared distinctive wording; each judge then decides which of its
 * observations are one defect and rules on every one of them in the same call.
 * A finding with no partner is a batch of one, so batching can only remove
 * judge calls, never add them.
 *
 * Each judge is shown the records the memory holds for the plan files its batch
 * spans, so it can say a finding repeats one of them rather than having the
 * engine guess from two readers' wordings. Superseded records are neither shown
 * nor accepted as a match: their question lives on the record that absorbed
 * them, and a finding attached to one would land on a record nothing checks.
 *
 * The input `gaps` array is what comes back, same members in the same order,
 * every one of them carrying an outcome. Building the result FROM the input is
 * the only shape where a finding cannot silently disappear, rather than one
 * where a branch has to remember it.
 */
export const judgeGaps = async (params: Params): Promise<{ gaps: GradedGap[]; rateLimited: boolean }> => {
	const { cwd, files, gaps, skipReason, memory } = params;
	// A wall met by launching another dozen spawns into it is still a wall, so a
	// skipped pass batches nothing and spawns nothing — and nothing to weigh
	// batches nothing on its own. Both still go through the join, which is where an
	// unjudged finding gets its stamp and its reason, here and nowhere else.
	const batches = skipReason === undefined ? groupGapCandidates({ gaps, files }) : [];
	const results = await drainTasks({
		tasks: batches.map((batch, batchIndex) => () => spawnGapJudge({ params, batch, batchIndex })),
		concurrency: planAgentConcurrency,
		shouldStop: ({ results: settled }) => settled.some((result) => isRateLimited({ result })),
	});
	const recordIds = new Set(memory.findings.filter(({ status }) => judgeableStatuses.includes(status)).map(({ id }) => id));

	return {
		gaps: await matchGapVerdicts({ cwd, gaps, batches, batchOutcomes: results.map((result) => result?.outcome), noJudgeReason: skipReason, recordIds }),
		rateLimited: results.some((result) => isRateLimited({ result })),
	};
};
