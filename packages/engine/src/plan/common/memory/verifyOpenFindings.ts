import { relative } from 'node:path';
import { buildPlanFindingRecheckInvocation } from '#src/agents/index.ts';
import { type Effort, GapOutcome, GapVerdict, type GradeFindingRecord, GradeFindingStatus, type GradeMemory, type Permissions } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { AgentOutcome } from '#src/invoke/index.ts';
import { planAgentConcurrency } from '#src/plan/common/constants/planAgentConcurrency.ts';
import { confirmCitation } from '#src/plan/common/memory/confirmCitation.ts';
import { recheckPlanText } from '#src/plan/common/memory/recheckPlanText.ts';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';
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
	/** Every plan file with its current text — the record's phase is looked up here. */
	files: DeliverableFile[];
	memory: GradeMemory;
	/** The pass timestamp written into a closed record's `resolution.verifiedAt`. */
	at: string;
	/** Set when the caller already hit the rate-limit wall: nothing is spawned and every record stays open. */
	skipReason?: string;
}

/** One open record paired with the current plan text it is asked about — the same text both the judge and the citation check read. */
interface RecheckPair {
	record: GradeFindingRecord;
	planText: string;
}

/** One re-verification spawn: its own runner and its own transcript, because a sink shared by a dozen judges interleaves into one unreadable file. */
const spawnRecheck = async ({ params, pair }: { params: Params; pair: RecheckPair }) => {
	// Ten minutes, the judges' number rather than the readers' thirty: a
	// re-verification judge that never answers leaves its record open, which
	// blocks, so its failure costs one extra question rather than a lost pass.
	const { cwd, driver, workspaceDir, overviewText, standards, model, effort, permissions, timeoutMs = 10 * 60 * 1000 } = params;
	const invokePlanAgent = createPlanAgentRunner({
		cwd,
		driver,
		workspaceDir,
		step: `grade-recheck-${pair.record.id}`,
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
		}),
		contract: GapVerdict,
	});

	return { outcome };
};

/**
 * What one judge's answer does to its record: closes it on a cited
 * `already-answered` the engine can confirm, and leaves it open — with the
 * refusal on record — on anything else.
 */
const settleRecord = async ({ cwd, pair, outcome, at }: { cwd: string; pair: RecheckPair; outcome: AgentOutcome<GapVerdict> | undefined; at: string }) => {
	const report = outcome?.ok === true ? outcome.report : undefined;
	const citation = report?.outcome === GapOutcome.AlreadyAnswered ? (report.answerAt ?? '') : undefined;
	const confirmed = citation === undefined ? undefined : await confirmCitation({ cwd, citation, planText: pair.planText });

	if (confirmed?.ok !== true || citation === undefined) {
		return { record: { ...pair.record, resolution: undefined }, refusal: confirmed?.ok === false ? confirmed.reason : undefined };
	}

	const resolution = { answerAt: citation, verifiedAt: at };

	return { record: { ...pair.record, status: GradeFindingStatus.Resolved, resolution }, refusal: undefined };
};

/**
 * Ask, once per open record, whether the plan now states the answer.
 *
 * This is the only path that closes a record. A later reader's silence is not
 * evidence — the question it stopped reporting may simply not have come up
 * again — so an unanswered record keeps blocking until a judge points at where
 * the plan settles it AND the engine confirms that citation. Every other answer,
 * a judge that failed, and a fan-out that met the rate-limit wall all leave the
 * record open, because none of them is evidence of anything.
 *
 * The text a record is asked against is its own plan file, or the whole plan
 * when its phase names no deliverable file — see `recheckPlanText`.
 */
export const verifyOpenFindings = async (params: Params): Promise<{ memory: GradeMemory; rateLimited: boolean; refusals: Map<string, string> }> => {
	const { cwd, files, overviewText, memory, at, skipReason } = params;
	const open = memory.findings.filter((record) => record.status === GradeFindingStatus.Open);
	// A wall met by launching another dozen spawns into it is still a wall, so a
	// skipped pass asks nothing and every record simply stays open.
	const asked = skipReason === undefined ? open : [];
	const pairs = asked.map((record) => ({ record, planText: recheckPlanText({ files, overviewText, phase: record.phase }) }));
	const results = await drainTasks({
		tasks: pairs.map((pair) => () => spawnRecheck({ params, pair })),
		concurrency: planAgentConcurrency,
		shouldStop: ({ results: settled }) => settled.some((result) => isRateLimited({ result })),
	});
	const settled = new Map<string, GradeFindingRecord>();
	const refusals = new Map<string, string>();

	for (const [slot, pair] of pairs.entries()) {
		const { record, refusal } = await settleRecord({ cwd, pair, outcome: results[slot]?.outcome, at });

		settled.set(record.id, record);

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
