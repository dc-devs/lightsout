import { basename, join } from 'node:path';
import { writeJsonFile } from '#src/common/utils/writeJsonFile.ts';
import { ActivityLevelKind } from '#src/contracts/activity/ActivityLevelKind.ts';
import type { GradeReport } from '#src/contracts/plan/grade/GradeReport.ts';
import type { StructuralFinding } from '#src/contracts/plan/grade/StructuralFinding.ts';
import type { GradeInputs } from '#src/contracts/plan/memory/GradeInputs.ts';
import type { GradeMemory } from '#src/contracts/plan/memory/GradeMemory.ts';
import type { GradeScope } from '#src/contracts/plan/memory/GradeScope.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import { appendGradeHistory } from '#src/plan/appendGradeHistory.ts';
import { gradeFileName } from '#src/plan/common/constants/gradeFileName.ts';
import { collapseGroupedGaps } from '#src/plan/common/grading/collapseGroupedGaps.ts';
import { createGradeReport } from '#src/plan/common/grading/createGradeReport.ts';
import { drainGradeAgents } from '#src/plan/common/grading/drainGradeAgents.ts';
import { prepareGradePass } from '#src/plan/common/grading/prepareGradePass.ts';
import { mergeFindingRecords } from '#src/plan/common/memory/mergeFindingRecords.ts';
import { openFindingGaps } from '#src/plan/common/memory/openFindingGaps.ts';
import { recordPassCoverage } from '#src/plan/common/memory/recordPassCoverage.ts';
import { verifyOpenFindings } from '#src/plan/common/memory/verifyOpenFindings.ts';
import { writeGradeMemory } from '#src/plan/common/memory/writeGradeMemory.ts';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';
import type { DetectionPass } from '#src/plan/common/types/DetectionPass.ts';
import type { GradeStamp } from '#src/plan/common/types/GradeStamp.ts';
import type { PlanGradeParams } from '#src/plan/common/types/PlanGradeParams.ts';

interface Params {
	params: PlanGradeParams;
	pass: DetectionPass;
	/** The plan files this pass offers the readers, already narrowed to the decided scope. */
	selected: DeliverableFile[];
	scope: GradeScope;
	/** The phase basenames a focused pass read; empty on a full pass. */
	focusedOn: string[];
	/** Why this pass reached as far as it did — recorded on the report and printed at the terminal. */
	scopeReason: string;
	/** This pass's fingerprint, recorded on the report and in the memory. */
	inputs: GradeInputs;
	/** The memory as this pass found it. */
	memory: GradeMemory;
	/** The structural findings, already computed once for the invocation. */
	structural: StructuralFinding[];
	stamp: GradeStamp;
	progress: (message: string) => void;
}

/**
 * What the next pass narrows against, and what a later invocation may report as
 * current — each recorded only by a pass entitled to claim it.
 *
 * A pass records itself as the baseline when it finished every check its own
 * scope called for, and otherwise leaves the baseline exactly where it was: a
 * pass that lost a reader never read that phase's text, so it cannot vouch for
 * it and must not shrink the next pass's scope.
 *
 * A focused pass may store the WHOLE input fingerprint because, by invariant,
 * the only inputs it differs from its baseline by are ones it read or that the
 * coverage record already covers at their current text.
 *
 * `lastPassingFullReview` no longer tests how far this pass reached. Its name
 * stays accurate all the same: `complete` means every plan file is covered at its
 * current text, which is a full review of the plan however few files this one
 * pass happened to read.
 */
const nextBaselines = ({ memory, report, inputs, at }: { memory: GradeMemory; report: GradeReport; inputs: GradeInputs; at: string }) => ({
	lastPass: report.scopeComplete ? { scope: report.scope, inputs, at } : memory.lastPass,
	lastPassingFullReview: report.complete && report.passed ? { inputs, at } : memory.lastPassingFullReview,
});

/**
 * The pass's three records, written before the runner returns whatever the
 * outcome: the engine gives up on a rate limit immediately with no retry, so
 * discarding the pass would turn one unlucky checker into thirty wasted spawns.
 * The coverage fields are what make a partial record safe to keep, and the read
 * coverage inside the memory is what keeps the reading it did pay for.
 */
const persistPass = async ({
	cwd,
	name,
	workspaceDir,
	report,
	memory,
}: {
	cwd: string;
	name: string;
	workspaceDir: string;
	report: GradeReport;
	memory: GradeMemory;
}) => {
	await writeJsonFile({ path: join(workspaceDir, gradeFileName), value: report });
	await appendGradeHistory({ cwd, name, report });
	await writeGradeMemory({ cwd, name, memory });
};

/**
 * One complete semantic pass, start to finish: weigh the selection, re-check
 * what the memory holds settled, run the agents, fold what they found back into
 * the memory, and persist the verdict beside it.
 *
 * It is its own function because what it writes — the verdict, the history line,
 * the finding memory and the read coverage — has to be written together or not
 * at all.
 *
 * The order inside it is load-bearing. `prepareGradePass` settles everything the
 * pass knows before it spawns anything — what the recorded coverage still
 * covers, whether the documentation checker has anything to ask, and which
 * resolutions the plan no longer supports. Its coverage answer then decides
 * which open records a re-verification judge is bought for, through the same
 * answer `decideGradeScope` narrowed the readers by. Only then are this pass's
 * own findings folded in, and every record still open joins the gap list, which
 * is what keeps a blocker blocking when no reader happened to report it again. A
 * record no judge settled on an earlier pass is `pending`: it is carried into the
 * judge stage because it needs a ruling, not a re-read. The gap list is collapsed
 * last, so the gaps one record holds reach the report as a single repair item.
 *
 * `recordPassCoverage` runs before the verdict is built, because the verdict
 * speaks for the whole plan and so must see what this pass itself just read.
 *
 * The pass's own activity level is opened here rather than in the caller, so the
 * row is the pass rather than the command run. Every spawn below it is attached
 * by SUBSTITUTING the pass into the params object it is handed, so the judge —
 * which is called with a spread of that same object — lands on the pass too, with
 * no override for a later edit to forget.
 */
export const runGradePass = async (args: Params): Promise<{ report: GradeReport; memory: GradeMemory; rateLimited: boolean; failures: string[] }> => {
	const { params, pass, scope, focusedOn, scopeReason, inputs, structural, stamp, progress } = args;
	const { cwd, name, phases } = params;
	const passLevel = params.level?.open({ level: ActivityLevelKind.Pass, label: `${scope} pass` });
	const passParams = { ...params, level: passLevel };
	// Substituted once, here: every step below is handed the pass level rather
	// than the command run's, with no override for a later edit to forget.
	const passArgs = { ...args, params: passParams };
	const at = new Date().toISOString();
	const { planFiles, weights, heavy, light, connections, found, documentation, memory: opened, carried } = await prepareGradePass({ ...passArgs, at });
	const agents = await drainGradeAgents({ params: passParams, pass, selected: heavy, carried, memory: opened, documentation, progress });
	const verified = await verifyOpenFindings({
		...passParams,
		workspaceDir: pass.workspaceDir,
		overviewText: pass.overviewText,
		files: pass.files,
		memory: opened,
		at,
		skipReason: agents.rateLimited ? 'the reader fan-out hit the rate-limit wall, so no finding was re-verified' : undefined,
		// The same value the reader selection narrowed by, never a second closure:
		// two reach rules that can disagree is the defect one reach rule avoids.
		invalidated: found.invalidated,
	});
	const merged = mergeFindingRecords({ memory: verified.memory, gaps: agents.gaps, at });
	const { coverage, standing } = recordPassCoverage({
		planFiles,
		overviewText: pass.overviewText,
		inputs,
		standing: found.readers,
		docs: found.docs,
		read: agents.read,
		light,
		connections,
		documentationChecked: documentation && agents.documentationComplete,
		// A human's `--phase` narrowing speaks only for the files they chose, so it
		// records nothing: writing entries from it is the one way it could buy an approval.
		narrowed: phases !== undefined,
		at,
	});
	// Collapsed after the open records join, so a pass finding and the surfaced
	// record it belongs to reach the report as one repair item.
	const gaps = collapseGroupedGaps({ gaps: [...merged.gaps, ...openFindingGaps({ memory: merged.memory, gaps: merged.gaps, refusals: verified.refusals })] });
	const report = createGradeReport({
		...stamp,
		name,
		phases,
		structural,
		gaps,
		failures: agents.failures,
		phasesChecked: agents.phasesChecked,
		weights,
		phasesLight: light,
		scope,
		focusedOn,
		inputs,
		scopeReason,
		phasesRequired: heavy.map((file) => basename(file.path)),
		documentationComplete: agents.documentationComplete,
		planFiles,
		covered: standing.covered,
		documentationCovered: standing.docs !== undefined,
	});
	const nextMemory: GradeMemory = { ...merged.memory, coverage, ...nextBaselines({ memory: merged.memory, report, inputs, at }), updatedAt: at };

	await persistPass({ cwd, name, workspaceDir: pass.workspaceDir, report, memory: nextMemory });

	const rateLimited = agents.rateLimited || verified.rateLimited;

	passLevel?.close({ outcome: rateLimited ? RunStatus.PausedRateLimit : agents.failures.length > 0 ? RunStatus.Failed : RunStatus.Passed });
	return { report, memory: nextMemory, rateLimited, failures: agents.failures };
};
