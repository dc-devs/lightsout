import { basename, join, relative } from 'node:path';
import { buildPlanGapCheckInvocation } from '#src/agents/index.ts';
import { writeJsonFile } from '#src/common/utils/writeJsonFile.ts';
import { type Effort, type GapCheckLens, GapCheckReport, type GradeReport, type Permissions } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { appendGradeHistory } from '#src/plan/appendGradeHistory.ts';
import { gapCheckLenses } from '#src/plan/common/constants/gapCheckLenses.ts';
import { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';
import { checkPlanDocumentation } from '#src/plan/common/grading/checkPlanDocumentation.ts';
import { createGradeReport } from '#src/plan/common/grading/createGradeReport.ts';
import { drainGapCheckers } from '#src/plan/common/grading/drainGapCheckers.ts';
import { notePriorArtCollisions } from '#src/plan/common/grading/notePriorArtCollisions.ts';
import { readGradeStamp } from '#src/plan/common/grading/readGradeStamp.ts';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';
import type { GapResult } from '#src/plan/common/types/GapResult.ts';
import { createPlanAgentRunner } from '#src/plan/common/utils/createPlanAgentRunner.ts';
import { getBlockingGaps } from '#src/plan/common/utils/getBlockingGaps.ts';
import { getPlanDetectionPass } from '#src/plan/common/utils/getPlanDetectionPass.ts';
import { judgeGaps } from '#src/plan/common/utils/judgeGaps.ts';
import { selectPhaseFiles } from '#src/plan/common/utils/selectPhaseFiles.ts';
import { lintPlanStructure } from '#src/plan/lint/index.ts';

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

/** One checker spawn: its own runner and its own transcript, because a sink shared by thirty agents interleaves into one unreadable file. */
const spawnGapChecker = async ({
	params,
	pass,
	file,
	lens,
	timeoutMs,
}: {
	params: Params;
	pass: Awaited<ReturnType<typeof getPlanDetectionPass>>;
	file: DeliverableFile;
	lens: GapCheckLens;
	timeoutMs: number;
}): Promise<GapResult> => {
	const { cwd, driver, standards, model, effort, permissions } = params;
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
		invocation: buildPlanGapCheckInvocation({
			planText: file.text,
			overviewText: pass.overviewText,
			standards,
			// Only a phased plan has siblings to point at, and the wiring checker
			// opens one itself when a consumed name's shape is declared elsewhere.
			planDir: pass.overviewText === undefined ? undefined : relative(cwd, pass.workspaceDir),
			lens,
		}),
		contract: GapCheckReport,
	});

	return { phase: basename(file.path), lens, outcome };
};

/**
 * The agent half of a grade: the per-file reader fan-out, the whole-plan
 * documentation check running beside it, and the judge that settles what the
 * readers found.
 *
 * The documentation check is concurrent with the fan-out so it costs money
 * rather than wall-clock, and its findings never reach the judge — the
 * checker's own job is that judgment.
 */
const drainGradeAgents = async ({
	params,
	pass,
	selected,
	progress,
}: {
	params: Params;
	pass: Awaited<ReturnType<typeof getPlanDetectionPass>>;
	selected: DeliverableFile[];
	progress: (message: string) => void;
}) => {
	// Resolved once for both spawns: two independent defaults let an edit to one
	// move that checker's ceiling and leave the other on the old number.
	const timeoutMs = params.timeoutMs ?? 30 * 60 * 1000;
	const tasks = selected.flatMap((file) => gapCheckLenses.map((lens) => () => spawnGapChecker({ params, pass, file, lens, timeoutMs })));
	const [readers, documentation] = await Promise.all([
		drainGapCheckers({ tasks, selected }),
		checkPlanDocumentation({
			cwd: params.cwd,
			driver: params.driver,
			name: params.name,
			workspaceDir: pass.workspaceDir,
			planPaths: pass.planPaths,
			files: pass.files,
			overviewText: pass.overviewText,
			docs: pass.config?.docs,
			model: params.model,
			effort: params.effort,
			permissions: params.permissions,
			timeoutMs,
			onProgress: progress,
		}),
	]);
	const judged = await judgeGaps({
		...params,
		workspaceDir: pass.workspaceDir,
		overviewText: pass.overviewText,
		selected,
		gaps: readers.gaps,
		skipReason: readers.rateLimited ? 'the reader fan-out hit the rate-limit wall, so no judge was spawned' : undefined,
	});

	return {
		gaps: [...judged.gaps, ...documentation.gaps],
		failures: [...readers.failures, ...documentation.failures],
		phasesChecked: readers.phasesChecked,
		rateLimited: readers.rateLimited || judged.rateLimited || documentation.rateLimited,
	};
};

/**
 * Read-only detector for a plan's grade: the deterministic structural re-check
 * the draft loop converged against, plus an agent gap-check for decision-level
 * gaps. It writes `grade.json`, appends the pass to the plan's append-only
 * grade history, and never edits the plan. `grade.json` is always the latest
 * pass; the history is every pass that ever ran. A single plan is
 * `.lightsout/plans/<name>/plan.md`; a phased plan is `overview.md` as context
 * plus each `phase<N>-<slug>.md` beside it.
 *
 * Every plan file is checked by three differently-briefed agents at once, and
 * every file's three run alongside every other file's. The union is the gap
 * list — nothing is voted on, because the same phase graded four times returned
 * a different count each time with every reported gap real, which is
 * under-detection rather than invention.
 *
 * That union is no longer the verdict. Once every reader has settled, each
 * finding is handed to its own judge answering one question — who settles this —
 * and only the findings a judge ruled need a human, plus the ones nobody judged,
 * decide the grade. Everything else is recorded in `grade.json` and gates
 * nothing: an A that required every reader to report nothing was reached by
 * exhausting the human rather than by finishing the plan.
 *
 * Every run re-reads every phase: skipping one whose text has not changed buys
 * money rather than clock once phases grade concurrently, and its failure mode
 * is a phase silently unchecked but reported clean. A human may narrow a pass
 * with `phases`, and that is recorded on the report's face; the structural lint
 * and the prior-art detection still cover EVERY plan file, because the lint is
 * cross-phase and one phase file alone would have it report the others' creates
 * as missing provenance and their hand-offs as unclaimed.
 *
 * One whole-plan documentation checker runs beside the per-file readers when —
 * and only when — the repository declares a `docs` block, verifying the claim
 * every implementable plan file states. Its findings bypass the judge, because
 * the checker's own job is that judgment; its failure makes the pass incomplete
 * for the same reason a reader's does. Like the lint, it covers the whole
 * deliverable even under a `--phase` narrowing: "does this plan touch a declared
 * document?" cannot be answered from one phase.
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
	// Read beside the lint rather than after the fan-out, so the stamped sha is the one the structural findings were measured against.
	const stamp = await readGradeStamp({ cwd });

	await notePriorArtCollisions({ cwd, name, workspaceDir, planPaths, config, onProgress: progress });

	const docsDeclared = (config?.docs?.length ?? 0) > 0;

	progress(
		`plan grade ${name}: ${structural.length} structural finding(s), gap-checking ${selected.length} of ${files.length} plan file(s) × ${gapCheckLenses.length} lens(es)${docsDeclared ? ', plus one whole-plan documentation check' : ''}`,
	);

	const agents = await drainGradeAgents({ params, pass, selected, progress });
	const report = createGradeReport({
		name,
		phases,
		structural,
		gaps: agents.gaps,
		failures: agents.failures,
		phasesChecked: agents.phasesChecked,
		commit: stamp.commit,
		treeDirty: stamp.treeDirty,
	});
	const gradePath = join(workspaceDir, 'grade.json');

	// Persisted before the runner returns, whatever the outcome: the engine gives
	// up on a rate limit immediately with no retry, so discarding the pass would
	// turn one unlucky checker into thirty wasted spawns. The coverage fields are
	// what make a partial record safe to keep.
	await writeJsonFile({ path: gradePath, value: report });
	await appendGradeHistory({ cwd, name, report });

	const blocking = getBlockingGaps({ gaps: report.gaps });

	progress(`plan grade ${name}: judged ${report.gaps.length} finding(s), ${blocking.length} blocking`);
	progress(`plan grade ${name}: ${report.grade} (${structural.length} structural, ${report.gaps.length} gap(s), ${blocking.length} blocking)`);

	// A wall outranks a gap-check failure: it stops the pass wherever it landed,
	// and the re-run line is the only thing a human can act on.
	if (agents.rateLimited) {
		const parked = `rate limited or overloaded — re-run: lightsout plan grade --name ${name}`;

		return { status: PlanRunStatus.PausedRateLimit, workspaceDir, error: parked, grade: report, gradePath };
	}

	return agents.failures.length > 0
		? { status: PlanRunStatus.Failed, workspaceDir, error: `gap-check failed for ${agents.failures.join('; ')}`, grade: report, gradePath }
		: { status: PlanRunStatus.Complete, workspaceDir, grade: report, gradePath };
};
