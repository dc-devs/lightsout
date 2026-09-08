import { join } from 'node:path';
import { writeJsonFile } from '#src/common/utils/writeJsonFile.ts';
import { type GradeInputs, type GradeMemory, type GradeReport, GradeScope, type StructuralFinding } from '#src/contracts/index.ts';
import { appendGradeHistory } from '#src/plan/appendGradeHistory.ts';
import { gapCheckLenses } from '#src/plan/common/constants/gapCheckLenses.ts';
import { gradeFileName } from '#src/plan/common/constants/gradeFileName.ts';
import { createGradeReport } from '#src/plan/common/grading/createGradeReport.ts';
import { drainGradeAgents } from '#src/plan/common/grading/drainGradeAgents.ts';
import { weighSelection } from '#src/plan/common/grading/weighSelection.ts';
import { mergeFindingRecords } from '#src/plan/common/memory/mergeFindingRecords.ts';
import { openFindingGaps } from '#src/plan/common/memory/openFindingGaps.ts';
import { revalidateResolutions } from '#src/plan/common/memory/revalidateResolutions.ts';
import { verifyOpenFindings } from '#src/plan/common/memory/verifyOpenFindings.ts';
import { writeGradeMemory } from '#src/plan/common/memory/writeGradeMemory.ts';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';
import type { GradeStamp } from '#src/plan/common/types/GradeStamp.ts';
import type { PlanGradeParams } from '#src/plan/common/types/PlanGradeParams.ts';
import type { getPlanDetectionPass } from '#src/plan/common/utils/getPlanDetectionPass.ts';

type DetectionPass = Awaited<ReturnType<typeof getPlanDetectionPass>>;

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

/** What the next pass narrows against, and what a later invocation may report as current — each recorded only by a pass entitled to claim it. */
const nextBaselines = ({ memory, report, inputs, at }: { memory: GradeMemory; report: GradeReport; inputs: GradeInputs; at: string }) => ({
	// A pass that lost a reader never read that phase's text, so it cannot vouch
	// for it and must not shrink the next pass's scope.
	lastPass: report.complete ? { scope: report.scope, inputs, at } : memory.lastPass,
	lastPassingFullReview: report.scope === GradeScope.Full && report.complete && report.passed ? { inputs, at } : memory.lastPassingFullReview,
});

/**
 * One complete semantic pass, start to finish: weigh the selection, re-check
 * what the memory holds settled, run the agents, fold what they found back into
 * the memory, and persist the verdict beside it.
 *
 * It is its own function because `plan grade` may run it twice in one
 * invocation — once focused over a repair's closure, then once over the whole
 * plan when that repair leaves nothing blocking — and a sequence written out
 * twice is two chances for one copy to stop writing the memory.
 *
 * The order inside it is load-bearing. Resolutions are revalidated first, with
 * no agent, so a record whose citation the plan no longer supports is reopened
 * in time for this very pass to re-judge it. The re-verification judges then run
 * over every open record in the whole plan, not just the phases the readers
 * read — a question a focused pass did not re-read is still unanswered. Only
 * then are this pass's own findings folded in, and every record still open joins
 * the gap list, which is what keeps a blocker blocking when no reader happened
 * to report it again.
 */
export const runGradePass = async ({
	params,
	pass,
	selected,
	scope,
	focusedOn,
	scopeReason,
	inputs,
	memory,
	structural,
	stamp,
	progress,
}: Params): Promise<{ report: GradeReport; memory: GradeMemory; rateLimited: boolean; failures: string[] }> => {
	const { cwd, name, phases } = params;
	const at = new Date().toISOString();
	const { weights, heavy, light } = weighSelection({ selected, config: pass.config });
	const documentation = scope === GradeScope.Full;
	const revalidated = await revalidateResolutions({ cwd, files: pass.files, overviewText: pass.overviewText, memory, at });

	progress(
		`plan grade ${name}: ${scope} pass — ${structural.length} structural finding(s), gap-checking ${heavy.length} of ${pass.files.length} plan file(s) × ${gapCheckLenses.length} lens(es)${light.length > 0 ? `, ${light.length} weighed light and read by nobody` : ''}${revalidated.reopened.length > 0 ? `, ${revalidated.reopened.length} resolved finding(s) reopened because the plan no longer states their answer` : ''}`,
	);

	const agents = await drainGradeAgents({ params, pass, selected: heavy, memory: revalidated.memory, documentation, progress });
	const verified = await verifyOpenFindings({
		cwd,
		driver: params.driver,
		workspaceDir: pass.workspaceDir,
		overviewText: pass.overviewText,
		standards: params.standards,
		model: params.model,
		effort: params.effort,
		permissions: params.permissions,
		timeoutMs: params.timeoutMs,
		files: pass.files,
		memory: revalidated.memory,
		at,
		skipReason: agents.rateLimited ? 'the reader fan-out hit the rate-limit wall, so no finding was re-verified' : undefined,
	});
	const merged = mergeFindingRecords({ memory: verified.memory, gaps: agents.gaps, at });
	const gaps = [...merged.gaps, ...openFindingGaps({ memory: merged.memory, gaps: merged.gaps, refusals: verified.refusals })];
	const report = createGradeReport({
		name,
		phases,
		structural,
		gaps,
		failures: agents.failures,
		phasesChecked: agents.phasesChecked,
		weights,
		phasesLight: light,
		commit: stamp.commit,
		treeDirty: stamp.treeDirty,
		scope,
		focusedOn,
		inputs,
		scopeReason,
		readersSpawned: heavy.length > 0,
	});
	const nextMemory: GradeMemory = { ...merged.memory, ...nextBaselines({ memory: merged.memory, report, inputs, at }), updatedAt: at };

	// Persisted before the runner returns, whatever the outcome: the engine gives
	// up on a rate limit immediately with no retry, so discarding the pass would
	// turn one unlucky checker into thirty wasted spawns. The coverage fields are
	// what make a partial record safe to keep.
	await writeJsonFile({ path: join(pass.workspaceDir, gradeFileName), value: report });
	await appendGradeHistory({ cwd, name, report });
	await writeGradeMemory({ cwd, name, memory: nextMemory });

	return { report, memory: nextMemory, rateLimited: agents.rateLimited || verified.rateLimited, failures: agents.failures };
};
