import { basename, join } from 'node:path';
import { buildPlanGapCheckInvocation } from '#src/agents/index.ts';
import { writeJsonFile } from '#src/common/utils/writeJsonFile.ts';
import { type Effort, GapCheckLens, GapCheckReport, type GradedGap, type GradeReport, type Permissions, PlanGrade } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { AgentOutcome } from '#src/invoke/index.ts';
import { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';
import { planAgentConcurrency } from '#src/plan/common/constants/planAgentConcurrency.ts';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';
import { createPlanAgentRunner } from '#src/plan/common/utils/createPlanAgentRunner.ts';
import { drainTasks } from '#src/plan/common/utils/drainTasks.ts';
import { getBlockingFindings } from '#src/plan/common/utils/getBlockingFindings.ts';
import { getPlanDetectionPass } from '#src/plan/common/utils/getPlanDetectionPass.ts';
import { selectPhaseFiles } from '#src/plan/common/utils/selectPhaseFiles.ts';
import { detectPriorArtCandidates } from '#src/plan/detectPriorArtCandidates.ts';
import { lintPlanStructure } from '#src/plan/lintPlanStructure.ts';

interface Params {
	cwd: string;
	driver: Driver;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
	/** Gap-check only these plan files — a bare phase number (`3`) or a full basename. Absent → all of them; narrowed → always incomplete. */
	phases?: string[];
	/** Supplemental code standards, threaded into the gap-check so standards-conflict can fire. */
	standards?: string;
	model?: string;
	effort?: Effort;
	permissions?: Permissions;
	timeoutMs?: number;
	onProgress?: (message: string) => void;
}

type RunPlanGradeResult =
	| { status: typeof PlanRunStatus.Complete; workspaceDir: string; grade: GradeReport; gradePath: string }
	| { status: typeof PlanRunStatus.Failed; workspaceDir: string; error: string; grade?: GradeReport; gradePath?: string }
	| { status: typeof PlanRunStatus.PausedRateLimit; workspaceDir: string; error: string; grade?: GradeReport; gradePath?: string };

/** One checker's settled result, labelled with the pair it was spawned for. */
interface GapResult {
	phase: string;
	lens: GapCheckLens;
	outcome: AgentOutcome<GapCheckReport>;
}

/** Every lens, in declaration order — the fan-out's width per plan file. */
const gapCheckLenses = Object.values(GapCheckLens);

/** Whether a settled checker hit the harness rate-limit wall — the one outcome that stops the fan-out feeding it. */
const isRateLimited = ({ result }: { result: GapResult | undefined }) => result !== undefined && !result.outcome.ok && result.outcome.rateLimited;

/**
 * Fold every checker's outcome in one pass, after all have settled, so one
 * failure never hides another. A checker that returned contributes its gaps
 * whether or not its siblings failed, and a plan file is claimed as checked only
 * when EVERY lens returned for it — one with a failed or never-started lens is
 * absent rather than reported clean.
 */
const foldGapResults = ({ selected, results }: { selected: DeliverableFile[]; results: Array<GapResult | undefined> }) => {
	const gaps: GradedGap[] = [];
	const failures: string[] = [];
	const returned = new Map<string, number>();

	for (const result of results) {
		if (result === undefined) {
			continue;
		}

		if (!result.outcome.ok) {
			failures.push(`${result.phase}/${result.lens}: ${result.outcome.rateLimited ? 'rate limited or overloaded' : result.outcome.failure}`);
			continue;
		}

		returned.set(result.phase, (returned.get(result.phase) ?? 0) + 1);
		gaps.push(...result.outcome.report.gaps.map((gap) => ({ ...gap, phase: result.phase, lens: result.lens })));
	}

	const phasesChecked = selected.map((file) => basename(file.path)).filter((phase) => returned.get(phase) === gapCheckLenses.length);

	return { gaps, failures, phasesChecked };
};

/**
 * The verdict and the statement of what it covers, in one place. A pass is
 * complete only when nothing failed and nothing was withheld, and an incomplete
 * pass is never an A whatever it found. Advisory structural findings are
 * persisted but never decide the grade — an advisory is a note, not a defect.
 */
const createGradeReport = ({
	name,
	phases,
	structural,
	folded,
}: {
	name: string;
	phases?: string[];
	structural: Awaited<ReturnType<typeof lintPlanStructure>>;
	folded: ReturnType<typeof foldGapResults>;
}): GradeReport => {
	const { gaps, failures, phasesChecked } = folded;
	const narrowed = phases === undefined ? [] : [`graded a subset on request: ${phases.join(', ')} — the structural findings still cover every plan file`];
	const reasons = [...narrowed, ...failures];
	const complete = reasons.length === 0;
	const grade = complete && getBlockingFindings({ findings: structural }).length === 0 && gaps.length === 0 ? PlanGrade.A : PlanGrade.BelowA;

	return {
		planName: name,
		grade,
		structural,
		gaps,
		phasesChecked,
		lenses: gapCheckLenses,
		complete,
		incompleteReason: complete ? undefined : reasons.join('; '),
		passed: grade === PlanGrade.A,
		gradedAt: new Date().toISOString(),
	};
};

/** One checker spawn: its own runner and its own transcript, because a sink shared by thirty agents interleaves into one unreadable file. */
const spawnGapChecker = async ({
	params,
	pass,
	file,
	lens,
}: {
	params: Params;
	pass: Awaited<ReturnType<typeof getPlanDetectionPass>>;
	file: DeliverableFile;
	lens: GapCheckLens;
}): Promise<GapResult> => {
	const { cwd, driver, standards, model, effort, permissions, timeoutMs = 30 * 60 * 1000 } = params;
	const invokePlanAgent = createPlanAgentRunner({
		cwd,
		driver,
		workspaceDir: pass.workspaceDir,
		step: `grade-${basename(file.path, '.md')}-${lens}`,
		model,
		effort,
		permissions,
		timeoutMs,
	});
	const outcome = await invokePlanAgent({
		invocation: buildPlanGapCheckInvocation({ planText: file.text, overviewText: pass.overviewText, standards, lens }),
		contract: GapCheckReport,
	});

	return { phase: basename(file.path), lens, outcome };
};

/**
 * Read-only detector for a plan's grade: the deterministic structural re-check
 * the draft loop converged against, plus an agent gap-check for decision-level
 * gaps. It writes `grade.json` and never edits the plan. A single plan is
 * `.lightsout/plans/<name>/plan.md`; a phased plan is `overview.md` as context
 * plus each `phase<N>-<slug>.md` beside it.
 *
 * Every plan file is checked by three differently-briefed agents at once, and
 * every file's three run alongside every other file's. The union is the gap
 * list — nothing is voted on, because the same phase graded four times returned
 * a different count each time with every reported gap real, which is
 * under-detection rather than invention.
 *
 * Every run re-reads every phase: skipping one whose text has not changed buys
 * money rather than clock once phases grade concurrently, and its failure mode
 * is a phase silently unchecked but reported clean. A human may narrow a pass
 * with `phases`, and that is recorded on the report's face; the structural lint
 * and the prior-art detection still cover EVERY plan file, because the lint is
 * cross-phase and one phase file alone would have it report the others' creates
 * as missing provenance and their hand-offs as unclaimed.
 */
export const runPlanGrade = async (params: Params): Promise<RunPlanGradeResult> => {
	const { cwd, name, phases, onProgress } = params;
	const progress = onProgress ?? (() => undefined);
	const pass = await getPlanDetectionPass({ cwd, name });
	const { workspaceDir, files, planPaths, config, error } = pass;

	if (error) {
		return { status: PlanRunStatus.Failed, workspaceDir, error };
	}

	const selection = selectPhaseFiles({ files, phases });

	if ('error' in selection) {
		return { status: PlanRunStatus.Failed, workspaceDir, error: selection.error };
	}

	const { selected } = selection;
	// Both deterministic passes cover every plan file, overview included — the
	// overview has its own required-section set, and the lint is cross-phase.
	const structural = await lintPlanStructure({ cwd, planPaths, config });
	// Cheap advisory backstop for the Dedup Review phase: if planned symbols still
	// name-collide with existing exports, nudge — but never gate.
	const priorArtCandidates = await detectPriorArtCandidates({ cwd, planPaths, config });

	if (priorArtCandidates.length > 0) {
		progress(
			`plan grade ${name}: ${priorArtCandidates.length} planned symbol(s) still name-collide with existing exports — run \`lightsout plan dedup --name ${name}\``,
		);
	}

	progress(
		`plan grade ${name}: ${structural.length} structural finding(s), gap-checking ${selected.length} of ${files.length} plan file(s) × ${gapCheckLenses.length} lens(es)`,
	);

	const tasks = selected.flatMap((file) => gapCheckLenses.map((lens) => () => spawnGapChecker({ params, pass, file, lens })));
	// A wall met by launching another eighteen spawns into it is still a wall: a
	// five-hour budget does not clear in two minutes, so once one checker
	// rate-limits no further one starts. A hard failure is usually specific to one
	// checker and does NOT stop the queue.
	const results = await drainTasks({
		tasks,
		concurrency: planAgentConcurrency,
		shouldStop: ({ results: settled }) => settled.some((result) => isRateLimited({ result })),
	});
	const folded = foldGapResults({ selected, results });
	const report = createGradeReport({ name, phases, structural, folded });
	const gradePath = join(workspaceDir, 'grade.json');

	// Persisted before the runner returns, whatever the outcome: the engine gives
	// up on a rate limit immediately with no retry, so discarding the pass would
	// turn one unlucky checker into thirty wasted spawns. The coverage fields are
	// what make a partial record safe to keep.
	await writeJsonFile({ path: gradePath, value: report });

	progress(`plan grade ${name}: ${report.grade} (${structural.length} structural, ${report.gaps.length} gap(s))`);

	if (results.some((result) => isRateLimited({ result }))) {
		const parked = `rate limited or overloaded — re-run: lightsout plan grade --name ${name}`;

		return { status: PlanRunStatus.PausedRateLimit, workspaceDir, error: parked, grade: report, gradePath };
	}

	return folded.failures.length > 0
		? { status: PlanRunStatus.Failed, workspaceDir, error: `gap-check failed for ${folded.failures.join('; ')}`, grade: report, gradePath }
		: { status: PlanRunStatus.Complete, workspaceDir, grade: report, gradePath };
};
