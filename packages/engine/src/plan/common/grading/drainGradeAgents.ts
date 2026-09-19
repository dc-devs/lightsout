import { basename, relative } from 'node:path';
import { buildPlanGapCheckInvocation } from '#src/agents/index.ts';
import { type GapCheckLens, GapCheckReport, type GradedGap, GradeFindingStatus, type GradeMemory } from '#src/contracts/index.ts';
import { gapCheckLenses } from '#src/plan/common/constants/gapCheckLenses.ts';
import { checkPlanDocumentation } from '#src/plan/common/grading/checkPlanDocumentation.ts';
import { drainGapCheckers } from '#src/plan/common/grading/drainGapCheckers.ts';
import { judgeGaps } from '#src/plan/common/grading/judgeGaps.ts';
import { phaseFindingRecords } from '#src/plan/common/memory/phaseFindingRecords.ts';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';
import type { DetectionPass } from '#src/plan/common/types/DetectionPass.ts';
import type { GapResult } from '#src/plan/common/types/GapResult.ts';
import type { PlanGradeParams } from '#src/plan/common/types/PlanGradeParams.ts';
import { createPlanAgentRunner } from '#src/plan/common/utils/createPlanAgentRunner.ts';

/** The record states a reader is shown: questions somebody already settled, and nothing that is still open. */
const settledStatuses = [GradeFindingStatus.Resolved, GradeFindingStatus.Noted];

interface Params {
	params: PlanGradeParams;
	pass: DetectionPass;
	selected: DeliverableFile[];
	/** The pending records this pass re-offers to the judge: findings no judge settled on an earlier pass, which need a ruling rather than a re-read. */
	carried: GradedGap[];
	/** The plan's finding memory — settled records for the readers, every record for the judges. */
	memory: GradeMemory;
	/** Whether the whole-plan documentation checker runs: true when its own coverage record is missing or stale, whatever this pass's scope. The caller decides it; nothing here reads the scope. */
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
	const { cwd, driver, standards, model, effort, permissions, level } = params;
	const invokePlanAgent = createPlanAgentRunner({
		cwd,
		driver,
		workspaceDir: pass.workspaceDir,
		step: `grade-${basename(file.path, '.md')}-${lens}`,
		level,
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
 * It needs no notion of weight: handed an empty selection it spawns no reader,
 * and no judge unless a pending record is carried in, and the documentation
 * checker still runs whenever a `docs` block is declared AND this pass is one it
 * belongs to.
 *
 * `documentation` says whether the whole-plan documentation checker's OWN
 * coverage record is missing or stale. It keys on that record rather than on
 * this pass's scope: with no trailing whole-plan review left to fall back on, a
 * checker skipped for being on a narrow pass would let an approval be granted
 * having never run it since the baseline. A record that still stands buys no
 * spawn, which is the repeated work a narrowed pass exists to avoid.
 *
 * The memory is threaded two ways, both read-only. Each reader is shown the
 * settled records for its own plan file, so a question already answered is not
 * re-asked; each judge is shown every record for the plan files its batch
 * spans, so it can name the one a fresh finding repeats.
 *
 * The pending records carried in join the readers' findings at the judge stage
 * and nowhere else: a carried record is not a plan file anybody read, so the
 * reader fan-out and the coverage it claims are exactly what they would be
 * without it.
 *
 * `documentationComplete` answers whether the documentation checker finished —
 * true too when it had nothing to do, which is a pass whose record still stands.
 * It is not the same question as whether that record STANDS, which is what feeds
 * `complete`; the two booleans sit one field apart on the report, so the
 * distinction is written down here rather than left to be inferred.
 */
export const drainGradeAgents = async ({
	params,
	pass,
	selected,
	carried,
	memory,
	documentation,
	progress,
}: Params): Promise<{
	gaps: GradedGap[];
	failures: string[];
	phasesChecked: string[];
	read: Array<{ phase: string; lens: GapCheckLens }>;
	rateLimited: boolean;
	documentationComplete: boolean;
}> => {
	// Resolved once for both spawns: two independent defaults let an edit to one
	// move that checker's ceiling and leave the other on the old number.
	const timeoutMs = params.timeoutMs ?? 30 * 60 * 1000;
	const tasks = selected.flatMap((file) => gapCheckLenses.map((lens) => () => spawnGapChecker({ params, pass, file, lens, timeoutMs, memory })));
	const [readers, docsCheck] = await Promise.all([
		drainGapCheckers({ tasks, selected }),
		checkPlanDocumentation({
			cwd: params.cwd,
			driver: params.driver,
			level: params.level,
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
		// Every plan file, not the readers' selection: a carried record may name a
		// file this pass weighed light or left out, and it still needs a judge.
		files: pass.files,
		gaps: [...readers.gaps, ...carried],
		skipReason: readers.rateLimited ? 'the reader fan-out hit the rate-limit wall, so no judge was spawned' : undefined,
		memory,
	});

	return {
		gaps: [...judged.gaps, ...docsCheck.gaps],
		failures: [...readers.failures, ...docsCheck.failures],
		phasesChecked: readers.phasesChecked,
		read: readers.read,
		rateLimited: readers.rateLimited || judged.rateLimited || docsCheck.rateLimited,
		documentationComplete: docsCheck.failures.length === 0,
	};
};
