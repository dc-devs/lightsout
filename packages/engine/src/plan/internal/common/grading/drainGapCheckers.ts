import { basename } from 'node:path';
import type { GapCheckLens } from '#src/contracts/plan/grade/GapCheckLens.ts';
import { GapOutcome } from '#src/contracts/plan/grade/GapOutcome.ts';
import type { GradedGap } from '#src/contracts/plan/grade/GradedGap.ts';
import { gapCheckLenses } from '#src/plan/internal/common/constants/gapCheckLenses.ts';
import { planAgentConcurrency } from '#src/plan/internal/common/constants/planAgentConcurrency.ts';
import type { DeliverableFile } from '#src/plan/internal/common/types/DeliverableFile.ts';
import type { GapResult } from '#src/plan/internal/common/types/GapResult.ts';
import { drainTasks } from '#src/plan/internal/common/utils/drainTasks.ts';
import { isRateLimited } from '#src/plan/internal/common/utils/isRateLimited.ts';

interface Params {
	/** One spawn per plan file × lens, each settling into its own `GapResult`. */
	tasks: Array<() => Promise<GapResult>>;
	/** The plan files the fan-out covers — a file is claimed as checked only when every lens returned for it. */
	selected: DeliverableFile[];
}

/**
 * Fold every checker's outcome in one pass, after all have settled, so one
 * failure never hides another. A checker that returned contributes its gaps
 * whether or not its siblings failed, and a plan file is claimed as checked only
 * when EVERY lens returned for it — one with a failed or never-started lens is
 * absent rather than reported clean.
 *
 * `phasesChecked` and `read` are two answers on purpose: the first is per plan
 * file and the second per plan file AND brief. Read coverage is recorded per
 * pair, so a brief that returned keeps the reading it was paid for even when a
 * sibling brief failed on the same file — and a brief added later re-runs only
 * itself.
 */
const foldGapResults = ({ selected, results }: { selected: DeliverableFile[]; results: Array<GapResult | undefined> }) => {
	const gaps: GradedGap[] = [];
	const failures: string[] = [];
	const returned = new Map<string, number>();
	const read: Array<{ phase: string; lens: GapCheckLens }> = [];

	for (const result of results) {
		if (result === undefined) {
			continue;
		}

		if (!result.outcome.ok) {
			failures.push(`${result.phase}/${result.lens}: ${result.outcome.rateLimited ? 'rate limited or overloaded' : result.outcome.failure}`);
			continue;
		}

		returned.set(result.phase, (returned.get(result.phase) ?? 0) + 1);
		read.push({ phase: result.phase, lens: result.lens });
		// Findings start unjudged: the judging stage rules each one, and anything it
		// never settles keeps this stamp and blocks.
		gaps.push(...result.outcome.report.gaps.map((gap) => ({ ...gap, phase: result.phase, lens: result.lens, outcome: GapOutcome.Unjudged, observations: [] })));
	}

	const phasesChecked = selected.map((file) => basename(file.path)).filter((phase) => returned.get(phase) === gapCheckLenses.length);

	return { gaps, failures, phasesChecked, read };
};

/**
 * Run every gap checker to settlement and fold what came back.
 *
 * A wall met by launching another eighteen spawns into it is still a wall: a
 * five-hour budget does not clear in two minutes, so once one checker
 * rate-limits no further one starts. A hard failure is usually specific to one
 * checker and does NOT stop the queue.
 */
export const drainGapCheckers = async ({
	tasks,
	selected,
}: Params): Promise<{
	gaps: GradedGap[];
	failures: string[];
	phasesChecked: string[];
	read: Array<{ phase: string; lens: GapCheckLens }>;
	rateLimited: boolean;
}> => {
	const results = await drainTasks({
		tasks,
		concurrency: planAgentConcurrency,
		shouldStop: ({ results: settled }) => settled.some((result) => isRateLimited({ result })),
	});

	return { ...foldGapResults({ selected, results }), rateLimited: results.some((result) => isRateLimited({ result })) };
};
