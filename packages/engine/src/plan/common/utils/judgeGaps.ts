import { basename, relative } from 'node:path';
import { buildPlanGapJudgeInvocation } from '#src/agents/index.ts';
import { type Effort, GapVerdict, type GradedGap, type Permissions } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { AgentOutcome } from '#src/invoke/index.ts';
import { planAgentConcurrency } from '#src/plan/common/constants/planAgentConcurrency.ts';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';
import { createPlanAgentRunner } from '#src/plan/common/utils/createPlanAgentRunner.ts';
import { drainTasks } from '#src/plan/common/utils/drainTasks.ts';
import { isRateLimited } from '#src/plan/common/utils/isRateLimited.ts';
import { matchGapVerdicts } from '#src/plan/common/utils/matchGapVerdicts.ts';

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
	/** The plan files the readers checked — each judge is given the text of the one its finding came from. */
	selected: DeliverableFile[];
	/** Every finding the readers returned, stamped `unjudged` by the fold. */
	gaps: GradedGap[];
	/** Set when the reader fan-out already hit the rate-limit wall: no judge is spawned and every finding keeps this as its reason. */
	skipReason?: string;
}

/** One finding, the plan text it was raised against, and its position in the reader's findings — the position is what lets the ruling be scattered back. */
interface GapPair {
	index: number;
	gap: GradedGap;
	planText: string;
}

/**
 * Each finding paired with the text of the plan file it came from, keeping its
 * index. A finding whose `phase` matches no selected file is simply not paired —
 * it cannot happen while the fold stamps every gap from these very files, but
 * nothing here depends on that staying true, because an unpaired finding still
 * comes back `unjudged` rather than disappearing.
 */
const pairGapsWithPlanText = ({ selected, gaps }: { selected: DeliverableFile[]; gaps: GradedGap[] }): GapPair[] =>
	selected.flatMap((file) => gaps.flatMap((gap, index) => (gap.phase === basename(file.path) ? [{ index, gap, planText: file.text }] : [])));

/** One judge spawn: its own runner and its own transcript, because a sink shared by twenty judges of one phase interleaves into one unreadable file. */
const spawnGapJudge = async ({ params, pair }: { params: Params; pair: GapPair }) => {
	// Ten minutes, not the readers' thirty: a judge is the one plan agent whose
	// failure is cheap — a timed-out judge leaves its finding `unjudged`, which
	// blocks, so it costs one extra question rather than a lost pass, while a hung
	// judge holding a slot for half an hour stalls the whole fan-out. Not five: a
	// reader takes about three minutes for more work, so ten fires only on
	// something genuinely stuck.
	const { cwd, driver, workspaceDir, overviewText, standards, model, effort, permissions, timeoutMs = 10 * 60 * 1000 } = params;
	const invokePlanAgent = createPlanAgentRunner({
		cwd,
		driver,
		workspaceDir,
		step: `grade-judge-${basename(pair.gap.phase, '.md')}-${pair.index}`,
		model,
		effort,
		permissions,
		timeoutMs,
	});
	const outcome = await invokePlanAgent({
		invocation: buildPlanGapJudgeInvocation({
			planText: pair.planText,
			overviewText,
			standards,
			// Only a phased plan has siblings to point at, and the judge opens one
			// itself when its finding is about a seam.
			planDir: overviewText === undefined ? undefined : relative(cwd, workspaceDir),
			gap: pair.gap,
		}),
		contract: GapVerdict,
	});

	return { outcome };
};

/**
 * Weigh every reader finding: one agent per finding, all at once, then the join.
 *
 * The narrowness of the question — who settles this one finding — is what makes
 * a judge steady, so a batch is never handed one; and the input `gaps` array is
 * what comes back, same members in the same order, every one of them carrying an
 * outcome. Building the result FROM the input is the only shape where a finding
 * cannot silently disappear, rather than one where a branch has to remember it.
 */
export const judgeGaps = async (params: Params): Promise<{ gaps: GradedGap[]; rateLimited: boolean }> => {
	const { cwd, selected, gaps, skipReason } = params;
	// A wall met by launching another twenty spawns into it is still a wall, so a
	// skipped pass pairs nothing and spawns nothing — and nothing to weigh pairs
	// nothing on its own. Both still go through the join, which is where an
	// unjudged finding gets its stamp and its reason, here and nowhere else.
	const pairs = skipReason === undefined ? pairGapsWithPlanText({ selected, gaps }) : [];
	const results = await drainTasks({
		tasks: pairs.map((pair) => () => spawnGapJudge({ params, pair })),
		concurrency: planAgentConcurrency,
		shouldStop: ({ results: settled }) => settled.some((result) => isRateLimited({ result })),
	});
	const judgeOutcomes: Array<AgentOutcome<GapVerdict> | undefined> = gaps.map(() => undefined);

	for (const [slot, pair] of pairs.entries()) {
		judgeOutcomes[pair.index] = results[slot]?.outcome;
	}

	return {
		gaps: await matchGapVerdicts({ cwd, gaps, judgeOutcomes, noJudgeReason: skipReason }),
		rateLimited: results.some((result) => isRateLimited({ result })),
	};
};
