import { basename, join } from 'node:path';
import { buildPlanDedupInvocation } from '#src/agents/index.ts';
import { writeJsonFile } from '#src/common/utils/writeJsonFile.ts';
import { type DedupFinding, DedupJudgment, type DedupReport, type Effort, type Permissions } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { AgentOutcome } from '#src/invoke/index.ts';
import { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';
import { planAgentConcurrency } from '#src/plan/common/constants/planAgentConcurrency.ts';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';
import type { PriorArtCandidate } from '#src/plan/common/types/PriorArtCandidate.ts';
import { createPlanAgentRunner } from '#src/plan/common/utils/createPlanAgentRunner.ts';
import { drainTasks } from '#src/plan/common/utils/drainTasks.ts';
import { getPlanDetectionPass } from '#src/plan/common/utils/getPlanDetectionPass.ts';
import { matchDedupVerdicts } from '#src/plan/common/utils/matchDedupVerdicts.ts';
import { detectPriorArtCandidates } from '#src/plan/detectPriorArtCandidates.ts';

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
	const { cwd, driver, standards, model, effort, permissions, timeoutMs = 30 * 60 * 1000 } = params;
	const invokePlanAgent = createPlanAgentRunner({
		cwd,
		driver,
		workspaceDir: pass.workspaceDir,
		step: `dedup-${basename(group.phase, '.md')}`,
		model,
		effort,
		permissions,
		timeoutMs,
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
 */
const foldDedupResults = ({ results }: { results: Array<DedupResult | undefined> }) => {
	const findings: DedupFinding[] = [];
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
	}

	return { findings, failures, rateLimited: results.some((result) => result !== undefined && !result.outcome.ok && result.outcome.rateLimited) };
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
 * labelled with the file that planned it. Gluing every phase into one prompt is
 * the single-agent-whole-plan shape the draft and the grade were split out of,
 * and it has not bitten yet only because the deterministic scan found no
 * collisions on the plans run so far. A judge that fails no longer discards the
 * pass: what finished is persisted, marked incomplete, and the runner still
 * reports the failure so a human re-runs.
 */
export const runPlanDedup = async (params: Params): Promise<RunPlanDedupResult> => {
	const { cwd, name, onProgress } = params;
	const progress = onProgress ?? (() => undefined);
	const pass = await getPlanDetectionPass({ cwd, name });
	const { workspaceDir, files: planFiles, planPaths, config, error } = pass;

	if (error) {
		return { status: PlanRunStatus.Failed, workspaceDir, error };
	}

	const candidates = await detectPriorArtCandidates({ cwd, planPaths, config });
	const dedupPath = join(workspaceDir, 'dedup.json');
	const writeReport = async ({ findings, incompleteReason }: { findings: DedupFinding[]; incompleteReason?: string }) => {
		const dedup: DedupReport = {
			planName: name,
			findings,
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

	const results = await drainTasks({
		tasks: groups.map((group) => () => spawnDedupJudge({ params, pass, group })),
		concurrency: planAgentConcurrency,
	});
	const { findings, failures, rateLimited } = foldDedupResults({ results });
	const dedup = await writeReport({ findings, incompleteReason: failures.length > 0 ? failures.join('; ') : undefined });

	progress(`plan dedup ${name}: ${findings.length} duplication(s) to review`);

	if (rateLimited) {
		const parked = `rate limited or overloaded — re-run: lightsout plan dedup --name ${name}`;

		return { status: PlanRunStatus.PausedRateLimit, workspaceDir, error: parked, dedup, dedupPath };
	}

	return failures.length > 0
		? { status: PlanRunStatus.Failed, workspaceDir, error: `dedup judge failed for ${failures.join('; ')}`, dedup, dedupPath }
		: { status: PlanRunStatus.Complete, workspaceDir, dedup, dedupPath };
};
