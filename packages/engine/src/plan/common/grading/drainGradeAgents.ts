import { basename, relative } from 'node:path';
import { buildPlanGapCheckInvocation } from '#src/agents/index.ts';
import { type GapCheckLens, GapCheckReport, type GradedGap } from '#src/contracts/index.ts';
import { gapCheckLenses } from '#src/plan/common/constants/gapCheckLenses.ts';
import { checkPlanDocumentation } from '#src/plan/common/grading/checkPlanDocumentation.ts';
import { drainGapCheckers } from '#src/plan/common/grading/drainGapCheckers.ts';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';
import type { GapResult } from '#src/plan/common/types/GapResult.ts';
import type { PlanGradeParams } from '#src/plan/common/types/PlanGradeParams.ts';
import { createPlanAgentRunner } from '#src/plan/common/utils/createPlanAgentRunner.ts';
import type { getPlanDetectionPass } from '#src/plan/common/utils/getPlanDetectionPass.ts';
import { judgeGaps } from '#src/plan/common/utils/judgeGaps.ts';

type DetectionPass = Awaited<ReturnType<typeof getPlanDetectionPass>>;

interface Params {
	params: PlanGradeParams;
	pass: DetectionPass;
	selected: DeliverableFile[];
	progress: (message: string) => void;
}

/** One checker spawn: its own runner and its own transcript, because a sink shared by thirty agents interleaves into one unreadable file. */
const spawnGapChecker = async ({
	params,
	pass,
	file,
	lens,
	timeoutMs,
}: {
	params: PlanGradeParams;
	pass: DetectionPass;
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
 * is declared.
 */
export const drainGradeAgents = async ({
	params,
	pass,
	selected,
	progress,
}: Params): Promise<{ gaps: GradedGap[]; failures: string[]; phasesChecked: string[]; rateLimited: boolean }> => {
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
