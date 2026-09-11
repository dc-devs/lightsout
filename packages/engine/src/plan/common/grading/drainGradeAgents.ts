import { basename, relative } from 'node:path';
import { buildPlanGapCheckInvocation } from '#src/agents/index.ts';
import { type GapCheckLens, GapCheckReport, type GradedGap, GradeFindingStatus, type GradeMemory } from '#src/contracts/index.ts';
import { gapCheckLenses } from '#src/plan/common/constants/gapCheckLenses.ts';
import { checkPlanDocumentation } from '#src/plan/common/grading/checkPlanDocumentation.ts';
import { drainGapCheckers } from '#src/plan/common/grading/drainGapCheckers.ts';
import { judgeGaps } from '#src/plan/common/grading/judgeGaps.ts';
import { phaseFindingRecords } from '#src/plan/common/memory/phaseFindingRecords.ts';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';
import type { GapResult } from '#src/plan/common/types/GapResult.ts';
import type { PlanGradeParams } from '#src/plan/common/types/PlanGradeParams.ts';
import { createPlanAgentRunner } from '#src/plan/common/utils/createPlanAgentRunner.ts';
import type { getPlanDetectionPass } from '#src/plan/common/utils/getPlanDetectionPass.ts';

type DetectionPass = Awaited<ReturnType<typeof getPlanDetectionPass>>;

/** The record states a reader is shown: questions somebody already settled, and nothing that is still open. */
const settledStatuses = [GradeFindingStatus.Resolved, GradeFindingStatus.Noted];

interface Params {
	params: PlanGradeParams;
	pass: DetectionPass;
	selected: DeliverableFile[];
	/** The plan's finding memory — settled records for the readers, every record for the judges. */
	memory: GradeMemory;
	/** Whether the whole-plan documentation checker runs. False on a focused pass, which reads part of the plan. */
	documentation: boolean;
	progress: (message: string) => void;
}

/** One checker spawn: its own runner and its own transcript, because a sink shared by thirty agents interleaves into one unreadable file. */
const spawnGapChecker = async ({
	params,
	pass,
	file,
	lens,
	timeoutMs,
	memory,
}: {
	params: PlanGradeParams;
	pass: DetectionPass;
	file: DeliverableFile;
	lens: GapCheckLens;
	timeoutMs: number;
	memory: GradeMemory;
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
		// Two, not one: a reader written off costs the plan file its coverage —
		// a file is claimed as checked only when every lens returned for it, so
		// losing readers means re-running the whole pass by hand. Each fresh
		// invocation still gets its one cheap re-emit, so four spawns is the
		// worst case. Not three: two is the smallest number that makes "re-run
		// rather than write off" true, and it caps the worst case at double.
		maxRoleAttempts: 2,
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
			settled: phaseFindingRecords({ memory, phase: basename(file.path), statuses: settledStatuses }),
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
 *
 * It needs no notion of weight: handed an empty selection it spawns no reader
 * and no judge, and the documentation checker still runs whenever a `docs` block
 * is declared AND this pass is one it belongs to.
 *
 * `documentation` is false on a focused pass. The checker reads the whole
 * deliverable, and a whole-plan checker is not part of a pass that reads two
 * phases — which is exactly the repeated work a focused pass exists to avoid.
 * Nothing is lost by skipping it: its open records keep blocking through the
 * memory, and the full review approval needs runs it again.
 *
 * The memory is threaded two ways, both read-only. Each reader is shown the
 * settled records for its own plan file, so a question already answered is not
 * re-asked; each judge is shown every record for its finding's file, so it can
 * name the one a fresh finding repeats.
 *
 * `documentationComplete` answers whether the documentation checker finished —
 * true too when it had nothing to do, as on a focused pass, where it cannot fail
 * and so cannot be routed around.
 */
export const drainGradeAgents = async ({
	params,
	pass,
	selected,
	memory,
	documentation,
	progress,
}: Params): Promise<{ gaps: GradedGap[]; failures: string[]; phasesChecked: string[]; rateLimited: boolean; documentationComplete: boolean }> => {
	// Resolved once for both spawns: two independent defaults let an edit to one
	// move that checker's ceiling and leave the other on the old number.
	const timeoutMs = params.timeoutMs ?? 30 * 60 * 1000;
	const tasks = selected.flatMap((file) => gapCheckLenses.map((lens) => () => spawnGapChecker({ params, pass, file, lens, timeoutMs, memory })));
	const [readers, docsCheck] = await Promise.all([
		drainGapCheckers({ tasks, selected }),
		checkPlanDocumentation({
			cwd: params.cwd,
			driver: params.driver,
			name: params.name,
			workspaceDir: pass.workspaceDir,
			planPaths: pass.planPaths,
			files: pass.files,
			overviewText: pass.overviewText,
			docs: documentation ? pass.config?.docs : undefined,
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
		memory,
	});

	return {
		gaps: [...judged.gaps, ...docsCheck.gaps],
		failures: [...readers.failures, ...docsCheck.failures],
		phasesChecked: readers.phasesChecked,
		rateLimited: readers.rateLimited || judged.rateLimited || docsCheck.rateLimited,
		documentationComplete: docsCheck.failures.length === 0,
	};
};
