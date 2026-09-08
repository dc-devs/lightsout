import { GapOutcome, type GapVerdict, type GradedGap } from '#src/contracts/index.ts';
import type { AgentOutcome } from '#src/invoke/index.ts';
import { citationPathToken } from '#src/plan/common/paths/citationPathToken.ts';
import { citedPathExists } from '#src/plan/common/paths/citedPathExists.ts';

interface Params {
	/** Repo root — a cited path is resolved against it before being checked. */
	cwd: string;
	/** Every finding the readers returned, in the order the judges were spawned for them. */
	gaps: GradedGap[];
	/** Each finding's judge outcome at the same index; `undefined` where the fan-out never started that judge. */
	judgeOutcomes: Array<AgentOutcome<GapVerdict> | undefined>;
	/** Why no judge ran, when the caller already knows — the rate-limit wall it declined to spawn into. Defaults to the fan-out having stopped mid-flight. */
	noJudgeReason?: string;
	/** Every memory record id the plan holds — what a verdict's `matchesFinding` may name. Absent means the plan has none, so any id points nowhere. */
	recordIds?: Set<string>;
}

/** Whether a string carries anything — an evidence field the judge left blank is the same as one it omitted. */
const isFilled = ({ value }: { value?: string }) => (value ?? '').trim().length > 0;

/** Whether the verdict carries the evidence its own outcome demands, which is the only thing separating a ruling from a rubber stamp. */
const hasRequiredEvidence = ({ verdict }: { verdict: GapVerdict }) => {
	const demanded: Record<GapVerdict['outcome'], boolean> = {
		[GapOutcome.NeedsAHuman]: isFilled({ value: verdict.humanDecision }),
		[GapOutcome.AgentCanDecide]: isFilled({ value: verdict.agentDecision }) && isFilled({ value: verdict.safeBecause }),
		[GapOutcome.AlreadyAnswered]: isFilled({ value: verdict.answerAt }),
	};

	return demanded[verdict.outcome];
};

/**
 * Whether an `already-answered` dismissal points at a file that is not there.
 * Deliberately narrow: only that outcome is checked, because the other two may
 * name a path the plan is about to create, and only a citation
 * `citationPathToken` reads as a path is checked at all, so a standards rule or
 * a plan line is left alone.
 */
const citesMissingPath = async ({ cwd, verdict }: { cwd: string; verdict: GapVerdict }) => {
	const token = citationPathToken({ citation: verdict.answerAt ?? '' });

	if (verdict.outcome !== GapOutcome.AlreadyAnswered || token === undefined) {
		return false;
	}

	return !(await citedPathExists({ cwd, token }));
};

/** Why nobody settled this finding, or `undefined` when a judge did — the one place every fail-closed branch is spelled. */
const getUnjudgedReason = async ({
	cwd,
	judgeOutcome,
	noJudgeReason,
	recordIds,
}: {
	cwd: string;
	judgeOutcome: AgentOutcome<GapVerdict> | undefined;
	noJudgeReason?: string;
	recordIds: Set<string>;
}) => {
	let reason: string | undefined;

	if (judgeOutcome === undefined) {
		reason = noJudgeReason ?? 'no judge ran — the fan-out stopped before this finding was judged';
	} else if (!judgeOutcome.ok) {
		reason = judgeOutcome.rateLimited ? 'the judge was rate limited or overloaded' : judgeOutcome.failure;
	} else if (!hasRequiredEvidence({ verdict: judgeOutcome.report })) {
		reason = `the judge answered ${judgeOutcome.report.outcome} without the evidence that outcome demands`;
	} else if (await citesMissingPath({ cwd, verdict: judgeOutcome.report })) {
		reason = `the judge cited ${judgeOutcome.report.answerAt}, which is not on disk`;
	} else if (judgeOutcome.report.matchesFinding !== undefined && !recordIds.has(judgeOutcome.report.matchesFinding)) {
		reason = `the judge matched this finding to ${judgeOutcome.report.matchesFinding}, which is not a record this plan holds`;
	}

	return reason;
};

/**
 * Join what the readers found with how the judges weighed it.
 *
 * The two halves of a judged gap come from different places and neither is
 * authoritative alone: the finding and its `phase`/`lens` are the engine's
 * stamps, while who has to settle it is the agent's judgment. The findings drive
 * the loop and the result keeps their membership and order exactly, so a finding
 * can never vanish between the readers and the report — matching by index is
 * safe because `drainTasks` returns results by task index.
 *
 * Everything fails closed. A judge that never ran, failed, answered without the
 * evidence its outcome demands, or dismissed a finding by citing a file that is
 * not on disk leaves that gap `unjudged` with the reason on it — and `unjudged`
 * blocks. An outcome without its evidence, and a dismissal pointing nowhere, are
 * rubber stamps the engine cannot tell from considered answers, so it declines
 * to believe either.
 *
 * Every unjudged gap is stamped here and nowhere else, including the case where
 * the caller declined to spawn any judge at all: it hands the reason in as
 * `noJudgeReason` and lets its findings through the same loop, so the shape of an
 * unjudged gap is written once rather than once per way of reaching it.
 *
 * A verdict naming a `matchesFinding` the plan's memory does not hold is stamped
 * the same way, for the same reason: the id is the judge's claim that this
 * finding repeats a settled question, and one that points nowhere is a claim the
 * engine cannot check.
 *
 * Unlike its dedup sibling this join touches disk, which is why it is `async`
 * and takes `cwd`: checking the citation is the whole reason `already-answered`
 * was made a citation rather than a bare reason.
 */
export const matchGapVerdicts = async ({ cwd, gaps, judgeOutcomes, noJudgeReason, recordIds = new Set() }: Params): Promise<GradedGap[]> => {
	const judged: GradedGap[] = [];

	for (const [index, gap] of gaps.entries()) {
		const judgeOutcome = judgeOutcomes[index];
		const unjudgedReason = await getUnjudgedReason({ cwd, judgeOutcome, noJudgeReason, recordIds });

		if (unjudgedReason !== undefined || judgeOutcome?.ok !== true) {
			judged.push({ ...gap, outcome: GapOutcome.Unjudged, unjudgedReason });
			continue;
		}

		// The agent's raw claim never reaches the record: what is persisted is the id
		// the engine resolved, which is why `matchesFinding` is dropped here.
		const { matchesFinding, ...verdict } = judgeOutcome.report;

		judged.push(matchesFinding === undefined ? { ...gap, ...verdict } : { ...gap, ...verdict, findingId: matchesFinding });
	}

	return judged;
};
