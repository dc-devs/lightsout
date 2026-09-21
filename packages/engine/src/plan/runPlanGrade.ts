import { basename, join } from 'node:path';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { writeJsonFile } from '#src/common/utils/writeJsonFile.ts';
import { type GradeInputs, type GradeMemory, type GradeReport, GradeScope, type StructuralFinding } from '#src/contracts/index.ts';
import { appendGradeHistory } from '#src/plan/appendGradeHistory.ts';
import { gradeFileName } from '#src/plan/common/constants/gradeFileName.ts';
import { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';
import { createGradeReport } from '#src/plan/common/grading/createGradeReport.ts';
import { notePriorArtCollisions } from '#src/plan/common/grading/notePriorArtCollisions.ts';
import { readGradeStamp } from '#src/plan/common/grading/readGradeStamp.ts';
import { readReusableGrade } from '#src/plan/common/grading/readReusableGrade.ts';
import { runGradePass } from '#src/plan/common/grading/runGradePass.ts';
import { gradeMemoryPath } from '#src/plan/common/memory/gradeMemoryPath.ts';
import { readGradeMemory } from '#src/plan/common/memory/readGradeMemory.ts';
import { decideGradeScope } from '#src/plan/common/scope/decideGradeScope.ts';
import { getGradeInputs } from '#src/plan/common/scope/getGradeInputs.ts';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';
import type { DetectionPass } from '#src/plan/common/types/DetectionPass.ts';
import type { GradeScopeDecision } from '#src/plan/common/types/GradeScopeDecision.ts';
import type { GradeStamp } from '#src/plan/common/types/GradeStamp.ts';
import type { PlanGradeParams } from '#src/plan/common/types/PlanGradeParams.ts';
import { getBlockingFindings } from '#src/plan/common/utils/getBlockingFindings.ts';
import { getBlockingGaps } from '#src/plan/common/utils/getBlockingGaps.ts';
import { getPlanDetectionPass } from '#src/plan/common/utils/getPlanDetectionPass.ts';
import { selectPhaseFiles } from '#src/plan/common/utils/selectPhaseFiles.ts';
import { lintPlanStructure } from '#src/plan/lint/index.ts';

type RunPlanGradeResult =
	| { status: typeof PlanRunStatus.Complete; workspaceDir: string; grade: GradeReport; gradePath: string; reused?: boolean }
	| { status: typeof PlanRunStatus.Failed; workspaceDir: string; error: string; grade?: GradeReport; gradePath?: string }
	| { status: typeof PlanRunStatus.PausedRateLimit; workspaceDir: string; error: string; grade?: GradeReport; gradePath?: string };

/** What one invocation's pass is run from, gathered once by the caller so the runner is handed one object rather than nine arguments. */
interface PassContext {
	params: PlanGradeParams;
	pass: DetectionPass;
	selected: DeliverableFile[];
	decision: GradeScopeDecision;
	inputs: GradeInputs;
	memory: GradeMemory;
	structural: StructuralFinding[];
	stamp: GradeStamp;
	progress: (message: string) => void;
}

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
const stopOnStructure = async ({
	params,
	gradePath,
	structural,
	blocking,
	stamp,
	progress,
}: {
	params: PlanGradeParams;
	gradePath: string;
	structural: StructuralFinding[];
	blocking: number;
	stamp: GradeStamp;
	progress: (message: string) => void;
}) => {
	const report = createGradeReport({
		name: params.name,
		phases: params.phases,
		structural,
		gaps: [],
		failures: [`${blocking} blocking structural finding(s) — the semantic readers were not launched`],
		phasesChecked: [],
		commit: stamp.commit,
		treeDirty: stamp.treeDirty,
		phasesRequired: [],
		documentationComplete: false,
	});

	await writeJsonFile({ path: gradePath, value: report });
	await appendGradeHistory({ cwd: params.cwd, name: params.name, report });
	progress(`plan grade ${params.name}: ${blocking} blocking structural finding(s) — stopped before any agent was spawned`);

	return report;
};

/**
 * The pass the scope decision chose — one pass, and the invocation ends with it.
 *
 * Approval is granted from the read coverage and the closed findings rather than
 * from how far one pass reached, so the pass that reads a repair is the pass that
 * may approve it. A whole-plan review bought afterwards would re-read files the
 * record already covers at the very text they still carry, which is the repeated
 * work the record exists to stop.
 */
const runDecidedPass = async (context: PassContext) => {
	const { params, pass, selected, decision, inputs, memory, structural, stamp, progress } = context;
	const focused = decision.scope === GradeScope.Focused;

	return runGradePass({
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
};

/**
 * Read-only detector for a plan's grade: the deterministic structural re-check
 * the draft loop converged against, plus an agent gap-check for decision-level
 * gaps. It writes `grade.json`, appends the pass to the plan's append-only grade
 * history, keeps one durable record per judged finding in `grade-memory.json`,
 * and never edits the plan. A single plan is
 * `.lightsout/tickets/<ticket-branch>/plans/<plan-id>/plan.md`;
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
 * them. What is left of that reach is narrowed once more by the read coverage:
 * a plan file a recorded pass already read at the very text it still carries is
 * not read again, and a pass approves once every plan file is covered at its
 * current text and every finding is closed — whatever that one pass itself read.
 * A recorded passing full review that still covers the current inputs is
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
export const runPlanGrade = async (params: PlanGradeParams): Promise<RunPlanGradeResult> => {
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
		const stopped = await stopOnStructure({ params, gradePath, structural, blocking: blockingStructural.length, stamp, progress });

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
			`plan grade ${name}: the recorded passing full review still covers the current inputs — nothing was re-run; delete ${await gradeMemoryPath({ cwd, name })} to force a new baseline`,
		);

		return { status: PlanRunStatus.Complete, workspaceDir, grade: reusable, gradePath, reused: true };
	}

	const memory: GradeMemory = found ?? { planName: name, findings: [], coverage: { readers: [] }, nextFindingNumber: 1, updatedAt: new Date().toISOString() };
	const last = await runDecidedPass({ params, pass, selected: selection.selected, decision, inputs, memory, structural, stamp, progress });
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
