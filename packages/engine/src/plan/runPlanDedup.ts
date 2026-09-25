import { basename, join } from 'node:path';
import type { ActivityLevel } from '#src/activity/common/types/ActivityLevel.ts';
import { buildPlanDedupInvocation } from '#src/agents/buildPlanDedupInvocation.ts';
import { writeJsonFile } from '#src/common/utils/writeJsonFile.ts';
import { ActivityLevelKind } from '#src/contracts/activity/ActivityLevelKind.ts';
import type { DedupFinding } from '#src/contracts/dedup/DedupFinding.ts';
import { DedupJudgment } from '#src/contracts/dedup/DedupJudgment.ts';
import type { DedupReport } from '#src/contracts/dedup/DedupReport.ts';
import type { ReviewedCollision } from '#src/contracts/dedup/ReviewedCollision.ts';
import type { Effort } from '#src/contracts/Effort.ts';
import type { Permissions } from '#src/contracts/Permissions.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import type { AgentOutcome } from '#src/invoke/common/types/AgentOutcome.ts';
import { getPlanRunStatus } from '#src/plan/common/activity/getPlanRunStatus.ts';
import { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';
import { planAgentConcurrency } from '#src/plan/common/constants/planAgentConcurrency.ts';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';
import type { PriorArtCandidate } from '#src/plan/common/types/PriorArtCandidate.ts';
import { createPlanAgentRunner } from '#src/plan/common/utils/createPlanAgentRunner.ts';
import { drainTasks } from '#src/plan/common/utils/drainTasks.ts';
import { getPlanDetectionPass } from '#src/plan/common/utils/getPlanDetectionPass.ts';
import { isRateLimited } from '#src/plan/common/utils/isRateLimited.ts';
import { matchDedupVerdicts } from '#src/plan/common/utils/matchDedupVerdicts.ts';
import { detectPriorArtCandidates } from '#src/plan/detectPriorArtCandidates.ts';
import { checkDeliverableSections } from '#src/plan/lint/checkDeliverableSections.ts';

interface Params {
	cwd: string;
	driver: Driver;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
	/** Supplemental code standards, threaded into the judge so extract/reuse recs can honor them. */
	standards?: string;
	model?: string;
	effort?: Effort;
	permissions?: Permissions;
	timeoutMs?: number;
	/** The command-run level the judge fan-out opens its own pass level under. Absent wherever no run is being recorded. */
	level?: ActivityLevel;
	onProgress?: (message: string) => void;
}

type RunPlanDedupResult =
	| { status: typeof PlanRunStatus.Complete; workspaceDir: string; dedup: DedupReport; dedupPath: string }
	| { status: typeof PlanRunStatus.Failed; workspaceDir: string; error: string; dedup?: DedupReport; dedupPath?: string }
	| { status: typeof PlanRunStatus.PausedRateLimit; workspaceDir: string; error: string; dedup?: DedupReport; dedupPath?: string };

/** One plan file's collisions, and the file's own text — everything one judge is given. */
interface DedupGroup {
	phase: string;
	text: string;
	candidates: PriorArtCandidate[];
}

/** One judge's settled result, labelled with the plan file it ruled on. */
interface DedupResult {
	group: DedupGroup;
	outcome: AgentOutcome<DedupJudgment>;
}

/** The plan files that actually have something to judge — a file with no collisions spawns nothing, the existing no-op rule now applied per file. */
const groupCandidates = ({ files, candidates }: { files: DeliverableFile[]; candidates: PriorArtCandidate[] }) => {
	const groups: DedupGroup[] = [];

	for (const file of files) {
		const phase = basename(file.path);
		const own = candidates.filter((candidate) => candidate.phase === phase);

		if (own.length > 0) {
			groups.push({ phase, text: file.text, candidates: own });
		}
	}

	return groups;
};

/** One judge spawn: its own runner, its own transcript, and only its own plan file's text and collisions. */
const spawnDedupJudge = async ({
	params,
	pass,
	group,
}: {
	params: Params;
	pass: Awaited<ReturnType<typeof getPlanDetectionPass>>;
	group: DedupGroup;
}): Promise<DedupResult> => {
	const { cwd, driver, standards, model, effort, permissions, timeoutMs = 30 * 60 * 1000, level } = params;
	const invokePlanAgent = createPlanAgentRunner({
		cwd,
		driver,
		workspaceDir: pass.workspaceDir,
		step: `dedup-${basename(group.phase, '.md')}`,
		model,
		effort,
		permissions,
		timeoutMs,
		level,
	});
	const outcome = await invokePlanAgent({
		invocation: buildPlanDedupInvocation({ planText: group.text, overviewText: pass.overviewText, candidates: group.candidates, standards }),
		contract: DedupJudgment,
	});

	return { group, outcome };
};

/**
 * Fold every judge's outcome in one pass, after all have settled. Each group's
 * verdicts are matched against that group's own candidates — a smaller and less
 * ambiguous set than the whole plan — and the findings concatenate in plan-file
 * order. A judge that failed contributes a labelled reason instead, and never
 * silences the groups that did return.
 *
 * `reviewed` is collected from the same loop and under the same condition: a
 * group whose judge returned had every one of its collisions weighed, whether
 * or not any became a finding. A group whose judge failed contributes nothing,
 * so a lost judge leaves its collisions unweighed rather than quietly recorded
 * as settled.
 */
const foldDedupResults = ({ results }: { results: Array<DedupResult | undefined> }) => {
	const findings: DedupFinding[] = [];
	const reviewed: ReviewedCollision[] = [];
	const failures: string[] = [];

	for (const result of results) {
		if (result === undefined) {
			continue;
		}

		if (!result.outcome.ok) {
			failures.push(`${result.group.phase}: ${result.outcome.rateLimited ? 'rate limited or overloaded' : result.outcome.failure}`);
			continue;
		}

		findings.push(...matchDedupVerdicts({ candidates: result.group.candidates, verdicts: result.outcome.report.verdicts }));
		reviewed.push(...result.group.candidates.map(({ plannedSymbol, plannedPath, phase }) => ({ plannedSymbol, plannedPath, phase })));
	}

	return { findings, reviewed, failures, rateLimited: results.some((result) => isRateLimited({ result })) };
};

/**
 * Read-only prior-art detector for the interactive Dedup Review pass:
 * deterministically detect every planned new symbol that name-collides with an
 * existing export (reusing the standards check's tier-0 comparator), then have
 * the judge agents rule which are real duplicates and how to resolve each. It
 * never edits the plan — it detects, judges, and writes `dedup.json`, the typed
 * findings the ignition skill reads to conduct the human resolution. No
 * candidates → no agent call, an empty report.
 *
 * A phased plan is judged one agent per plan file, all at once, each given only
 * its own file's text and its own file's collisions and each duplication
 * labelled with the file that planned it. The whole fan-out is one activity
 * level with a step per spawn, and a run with no candidates opens none at all:
 * a grouping row over zero spawns is a row for work that never happened.
 *
 * Gluing every phase into one prompt is the single-agent-whole-plan shape the
 * draft and the grade were split out of, and it has not bitten yet only because
 * the deterministic scan found no collisions on the plans run so far. A judge
 * that fails no longer discards the pass: what finished is persisted, marked
 * incomplete, and the runner still reports the failure so a human re-runs.
 */
export const runPlanDedup = async (params: Params): Promise<RunPlanDedupResult> => {
	const { cwd, name, onProgress } = params;
	const progress = onProgress ?? (() => undefined);
	const pass = await getPlanDetectionPass({ cwd, name });
	const { workspaceDir, files: planFiles, planPaths, config, error } = pass;

	if (error) {
		return { status: PlanRunStatus.Failed, workspaceDir, error };
	}

	const stale = checkDeliverableSections({ cwd, name, overviewText: pass.overviewText, files: planFiles, decisions: pass.decisions });

	// A read-only pass cannot compose the section, so it refuses to bless the plan
	// instead: no report on disk, no judge spawned, and the remedy named.
	if (stale.length > 0) {
		const files = [...new Set(stale.map(({ phase }) => phase))].join(', ');

		return { status: PlanRunStatus.Failed, workspaceDir, error: `${files}: ${stale[0].issue} — ${stale[0].fix}` };
	}

	const candidates = await detectPriorArtCandidates({ cwd, planPaths, config });
	const dedupPath = join(workspaceDir, 'dedup.json');
	const writeReport = async ({
		findings,
		reviewed = [],
		incompleteReason,
	}: {
		findings: DedupFinding[];
		reviewed?: ReviewedCollision[];
		incompleteReason?: string;
	}) => {
		const dedup: DedupReport = {
			planName: name,
			findings,
			reviewed,
			complete: incompleteReason === undefined,
			incompleteReason,
			reviewedAt: new Date().toISOString(),
		};

		await writeJsonFile({ path: dedupPath, value: dedup });

		return dedup;
	};

	// No candidates → no-op: an empty report, no agent call.
	if (candidates.length === 0) {
		progress(`plan dedup ${name}: no prior-art candidates — nothing to review`);

		return { status: PlanRunStatus.Complete, workspaceDir, dedup: await writeReport({ findings: [] }), dedupPath };
	}

	const groups = groupCandidates({ files: planFiles, candidates });

	progress(`plan dedup ${name}: ${candidates.length} candidate(s) detected across ${groups.length} plan file(s), judging`);

	const fanOut = params.level?.open({ level: ActivityLevelKind.Pass, label: 'judge fan-out' });
	const results = await drainTasks({
		tasks: groups.map((group) => () => spawnDedupJudge({ params: { ...params, level: fanOut }, pass, group })),
		concurrency: planAgentConcurrency,
	});
	const { findings, reviewed, failures, rateLimited } = foldDedupResults({ results });
	const dedup = await writeReport({ findings, reviewed, incompleteReason: failures.length > 0 ? failures.join('; ') : undefined });
	// Read once by the fan-out's end mark and by what this runner answers, so the
	// row in the report and the exit code can never disagree about the judges.
	const status = rateLimited ? PlanRunStatus.PausedRateLimit : failures.length > 0 ? PlanRunStatus.Failed : PlanRunStatus.Complete;

	progress(`plan dedup ${name}: ${findings.length} duplication(s) to review`);
	fanOut?.close({ outcome: getPlanRunStatus({ status }) });

	if (status === PlanRunStatus.PausedRateLimit) {
		const parked = `rate limited or overloaded — re-run: lightsout plan dedup --name ${name}`;

		return { status: PlanRunStatus.PausedRateLimit, workspaceDir, error: parked, dedup, dedupPath };
	}

	return failures.length > 0
		? { status: PlanRunStatus.Failed, workspaceDir, error: `dedup judge failed for ${failures.join('; ')}`, dedup, dedupPath }
		: { status: PlanRunStatus.Complete, workspaceDir, dedup, dedupPath };
};
