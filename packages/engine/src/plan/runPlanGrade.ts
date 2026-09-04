import { join } from 'node:path';
import { writeJsonFile } from '#src/common/utils/writeJsonFile.ts';
import type { GradeReport } from '#src/contracts/index.ts';
import { appendGradeHistory } from '#src/plan/appendGradeHistory.ts';
import { gapCheckLenses } from '#src/plan/common/constants/gapCheckLenses.ts';
import { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';
import { createGradeReport } from '#src/plan/common/grading/createGradeReport.ts';
import { drainGradeAgents } from '#src/plan/common/grading/drainGradeAgents.ts';
import { notePriorArtCollisions } from '#src/plan/common/grading/notePriorArtCollisions.ts';
import { readGradeStamp } from '#src/plan/common/grading/readGradeStamp.ts';
import { weighSelection } from '#src/plan/common/grading/weighSelection.ts';
import type { PlanGradeParams } from '#src/plan/common/types/PlanGradeParams.ts';
import { getBlockingGaps } from '#src/plan/common/utils/getBlockingGaps.ts';
import { getPlanDetectionPass } from '#src/plan/common/utils/getPlanDetectionPass.ts';
import { selectPhaseFiles } from '#src/plan/common/utils/selectPhaseFiles.ts';
import { lintPlanStructure } from '#src/plan/lint/index.ts';

type RunPlanGradeResult =
	| { status: typeof PlanRunStatus.Complete; workspaceDir: string; grade: GradeReport; gradePath: string }
	| { status: typeof PlanRunStatus.Failed; workspaceDir: string; error: string; grade?: GradeReport; gradePath?: string }
	| { status: typeof PlanRunStatus.PausedRateLimit; workspaceDir: string; error: string; grade?: GradeReport; gradePath?: string };

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
 * every file's three run alongside every other file's. A reader whose final
 * message fails the contract may be re-run once from scratch before it is
 * written off, because a lost reader costs its plan file the whole coverage
 * claim. The union is the gap list — nothing is voted on, because the same
 * phase graded four times returned a different count each time with every
 * reported gap real, which is under-detection rather than invention.
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
 * Which files those readers see is `weighSelection`'s answer: with
 * `plan.contract` on, only the plan files heavy enough to earn the fan-out pay
 * for it, and the rest are recorded on the report as read by nobody. With the
 * key off every selected file is read, exactly as before the key existed.
 *
 * One whole-plan documentation checker runs beside the per-file readers when —
 * and only when — the repository declares a `docs` block, verifying the claim
 * every implementable plan file states. Its findings bypass the judge, because
 * the checker's own job is that judgment; its failure makes the pass incomplete
 * for the same reason a reader's does. Like the lint, it covers the whole
 * deliverable even under a `--phase` narrowing: "does this plan touch a declared
 * document?" cannot be answered from one phase.
 */
export const runPlanGrade = async (params: PlanGradeParams): Promise<RunPlanGradeResult> => {
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
	const { weights, heavy, light } = weighSelection({ selected, config });

	progress(
		`plan grade ${name}: ${structural.length} structural finding(s), gap-checking ${heavy.length} of ${files.length} plan file(s) × ${gapCheckLenses.length} lens(es)${light.length > 0 ? `, ${light.length} weighed light and read by nobody` : ''}${docsDeclared ? ', plus one whole-plan documentation check' : ''}`,
	);

	const agents = await drainGradeAgents({ params, pass, selected: heavy, progress });
	const report = createGradeReport({
		name,
		phases,
		structural,
		gaps: agents.gaps,
		failures: agents.failures,
		phasesChecked: agents.phasesChecked,
		weights,
		phasesLight: light,
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
