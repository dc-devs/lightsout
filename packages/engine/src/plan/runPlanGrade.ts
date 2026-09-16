import { basename, join } from 'node:path';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { type GradeInputs, type GradeMemory, type GradeReport, GradeScope, type StructuralFinding } from '#src/contracts/index.ts';
import { gradeFileName } from '#src/plan/common/constants/gradeFileName.ts';
import { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';
import { notePriorArtCollisions } from '#src/plan/common/grading/notePriorArtCollisions.ts';
import { readGradeStamp } from '#src/plan/common/grading/readGradeStamp.ts';
import { readReusableGrade } from '#src/plan/common/grading/readReusableGrade.ts';
import { runGradePass } from '#src/plan/common/grading/runGradePass.ts';
import { stopOnPlanStructure } from '#src/plan/common/grading/stopOnPlanStructure.ts';
import { gradeMemoryPath } from '#src/plan/common/memory/gradeMemoryPath.ts';
import { readGradeMemory } from '#src/plan/common/memory/readGradeMemory.ts';
import { resolvePlanningAdapterRuntime } from '#src/plan/common/planning/resolvePlanningAdapterRuntime.ts';
import { decideGradeScope } from '#src/plan/common/scope/decideGradeScope.ts';
import { getGradeInputs } from '#src/plan/common/scope/getGradeInputs.ts';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';
import type { GradeScopeDecision } from '#src/plan/common/types/GradeScopeDecision.ts';
import type { GradeStamp } from '#src/plan/common/types/GradeStamp.ts';
import type { PlanGradeParams } from '#src/plan/common/types/PlanGradeParams.ts';
import { getBlockingFindings } from '#src/plan/common/utils/getBlockingFindings.ts';
import { getBlockingGaps } from '#src/plan/common/utils/getBlockingGaps.ts';
import { getPlanDetectionPass } from '#src/plan/common/utils/getPlanDetectionPass.ts';
import { selectPhaseFiles } from '#src/plan/common/utils/selectPhaseFiles.ts';
import { lintPlanStructure } from '#src/plan/lint/index.ts';
import { type PlanningRuntime, runPlanningGrade } from '#src/plan/workflow/index.ts';

const gradeCanonical = async ({ runtime, phases }: { runtime: PlanningRuntime; phases?: string[] }) => {
	try {
		return { status: PlanRunStatus.Complete, ...(await runPlanningGrade({ runtime, phases })) };
	} catch (error) {
		return { status: PlanRunStatus.Failed, workspaceDir: join(runtime.cwd, '.lightsout', 'plans', runtime.name), error: messageOf({ error }) };
	}
};
type DetectionPass = Awaited<ReturnType<typeof getPlanDetectionPass>>;

type RunPlanGradeResult =
	| { status: typeof PlanRunStatus.Complete; workspaceDir: string; grade: GradeReport; gradePath: string; reused?: boolean }
	| { status: typeof PlanRunStatus.Failed; workspaceDir: string; error: string; grade?: GradeReport; gradePath?: string }
	| { status: typeof PlanRunStatus.PausedRateLimit; workspaceDir: string; error: string; grade?: GradeReport; gradePath?: string };

/**
 * The pass a blocking structural finding buys: the verdict written and appended,
 * with no agent spawned and the finding memory untouched.
 *
 * It is recorded as an INCOMPLETE pass rather than as a new kind of result,
 * because that is what it is, and every reader of `grade.json` already knows
 * what an incomplete pass means. The memory is left alone because nothing was
 * judged: a stop that rewrote it would move a plan's settled decisions on
 * evidence it never gathered.
 */

/**
 * The decided pass, plus the full review a cleared focused one earns.
 *
 * A focused pass is a repair check and can never approve a plan, so a clean one
 * is the moment to pay for the review approval actually needs — in this same
 * invocation, because a caller that had to notice and re-run is a caller that
 * can forget to. A focused pass that still has a blocker stops here: the repair
 * is unproven, and the expensive full review would only say so again.
 */
const runDecidedPasses = async ({
	params,
	pass,
	selected,
	decision,
	inputs,
	memory,
	structural,
	stamp,
	progress,
}: {
	params: PlanGradeParams;
	pass: DetectionPass;
	selected: DeliverableFile[];
	decision: GradeScopeDecision;
	inputs: GradeInputs;
	memory: GradeMemory;
	structural: StructuralFinding[];
	stamp: GradeStamp;
	progress: (message: string) => void;
}) => {
	const focused = decision.scope === GradeScope.Focused;
	const first = await runGradePass({
		params,
		pass,
		selected: focused ? selected.filter((file) => decision.phases.includes(basename(file.path))) : selected,
		scope: decision.scope,
		focusedOn: focused ? decision.phases : [],
		scopeReason: decision.reason,
		inputs,
		memory,
		structural,
		stamp,
		progress,
	});
	const cleared = focused && !first.rateLimited && first.failures.length === 0 && getBlockingGaps({ gaps: first.report.gaps }).length === 0;

	if (!cleared) {
		return first;
	}

	return runGradePass({
		params,
		pass,
		selected,
		scope: GradeScope.Full,
		focusedOn: [],
		scopeReason: 'full review after the focused pass cleared every blocker',
		inputs,
		memory: first.memory,
		structural,
		stamp,
		progress,
	});
};

/**
 * Read-only detector for a plan's grade: the deterministic structural re-check
 * the draft loop converged against, plus an agent gap-check for decision-level
 * gaps. It writes `grade.json`, appends the pass to the plan's append-only grade
 * history, keeps one durable record per judged finding in `grade-memory.json`,
 * and never edits the plan. A single plan is `.lightsout/plans/<name>/plan.md`;
 * a phased plan is `overview.md` as context plus each `phase<N>-<slug>.md`.
 *
 * Every plan file a pass reads is checked by three differently-briefed agents at
 * once; each finding they return is then handed to its own judge answering one
 * question, who settles this. Only the findings a judge ruled need a human, plus
 * the ones nobody judged, decide the grade.
 *
 * **The structural preflight.** A plan the mechanical lint gates on is not worth
 * the semantic fan-out: those findings alone already put it below A. So a
 * blocking structural finding stops the pass before any agent is spawned, and
 * the verdict is written as an INCOMPLETE pass with an empty gap list — a stage
 * that did not run is unchecked, never passed.
 *
 * **How far a pass reaches** is the engine's decision, from a fingerprint of
 * everything the pass measures — the plan text, the code beside it, the
 * standards, the plan-relevant config, the prompt texts and the model. A
 * re-grade after a repair reads the edited phases and every phase connected to
 * them, falling back to the whole plan whenever that set cannot be established.
 * A recorded decision reaches the phases it names, and the phases connected to
 * them. A recorded passing full review that still covers the current inputs is
 * reported as current rather than paid for twice.
 *
 * **What the memory buys.** A question a judge already settled is not
 * re-investigated, and one nobody has verified as answered keeps blocking even
 * when a later reader happens not to report it again — a record closes only when
 * a re-verification judge points at where the plan now states the answer and the
 * engine confirms that citation.
 *
 * A human may still narrow a pass with `phases`, recorded on the report's face
 * exactly as before; the structural lint and the prior-art detection still cover
 * EVERY plan file, because the lint is cross-phase.
 */
export const runPlanGrade = async (params: PlanGradeParams | { runtime: PlanningRuntime; phases?: string[] }): Promise<RunPlanGradeResult> => {
	const runtime = 'runtime' in params ? params.runtime : await resolvePlanningAdapterRuntime(params);
	if (runtime) return gradeCanonical({ runtime, phases: params.phases });
	if ('runtime' in params) throw new Error('Canonical runtime is required');
	const { cwd, name, phases, onProgress, standards, model, effort } = params;
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

	const gradePath = join(workspaceDir, gradeFileName);
	// Both deterministic passes cover every plan file, overview included — the
	// overview has its own required-section set, and the lint is cross-phase.
	const structural = await lintPlanStructure({ cwd, planPaths, decisions: pass.decisions, config });
	// Read beside the lint rather than after the fan-out, so the stamped sha is the one the structural findings were measured against.
	const stamp = await readGradeStamp({ cwd });
	const blockingStructural = getBlockingFindings({ findings: structural });

	if (blockingStructural.length > 0) {
		const stopped = await stopOnPlanStructure({ params, gradePath, structural, blocking: blockingStructural.length, stamp, progress });

		return { status: PlanRunStatus.Complete, workspaceDir, grade: stopped, gradePath };
	}

	await notePriorArtCollisions({ cwd, name, workspaceDir, planPaths, config, onProgress: progress });

	let found: GradeMemory | undefined;

	try {
		found = await readGradeMemory({ cwd, name });
	} catch (cause) {
		return { status: PlanRunStatus.Failed, workspaceDir, error: messageOf({ error: cause }) };
	}

	const inputs = await getGradeInputs({ cwd, planPaths, decisions: pass.decisions.decisions, standards, config, model, effort });
	const decision = decideGradeScope({ files, overviewText: pass.overviewText, memory: found, inputs, narrowed: phases !== undefined });
	const reusable = decision.reuse ? await readReusableGrade({ gradePath, sha256: inputs.sha256 }) : undefined;

	if (reusable !== undefined) {
		progress(
			`plan grade ${name}: the recorded passing full review still covers the current inputs — nothing was re-run; delete ${gradeMemoryPath({ cwd, name })} to force a new baseline`,
		);

		return { status: PlanRunStatus.Complete, workspaceDir, grade: reusable, gradePath, reused: true };
	}

	const memory: GradeMemory = found ?? { planName: name, findings: [], nextFindingNumber: 1, updatedAt: new Date().toISOString() };
	const last = await runDecidedPasses({ params, pass, selected: selection.selected, decision, inputs, memory, structural, stamp, progress });
	const report = last.report;
	const blocking = getBlockingGaps({ gaps: report.gaps });

	progress(`plan grade ${name}: judged ${report.gaps.length} finding(s), ${blocking.length} blocking`);
	progress(`plan grade ${name}: ${report.grade} (${structural.length} structural, ${report.gaps.length} gap(s), ${blocking.length} blocking)`);

	// A wall outranks a gap-check failure: it stops the pass wherever it landed,
	// and the re-run line is the only thing a human can act on.
	if (last.rateLimited) {
		const parked = `rate limited or overloaded — re-run: lightsout plan grade --name ${name}`;

		return { status: PlanRunStatus.PausedRateLimit, workspaceDir, error: parked, grade: report, gradePath };
	}

	return last.failures.length > 0
		? { status: PlanRunStatus.Failed, workspaceDir, error: `gap-check failed for ${last.failures.join('; ')}`, grade: report, gradePath }
		: { status: PlanRunStatus.Complete, workspaceDir, grade: report, gradePath };
};
