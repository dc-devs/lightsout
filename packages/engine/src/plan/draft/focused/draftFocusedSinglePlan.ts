import { PlanVariant, StructuralCheck, type StructuralFinding } from '#src/contracts/index.ts';
import { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';
import { planDraftOutputs } from '#src/plan/common/paths/planDraftOutputs.ts';
import type { DraftContext } from '#src/plan/common/types/DraftContext.ts';
import type { RunPlanDraftResult } from '#src/plan/common/types/RunPlanDraftResult.ts';
import { buildPlanSyncDecisionsCommand, syncPlanDecisions } from '#src/plan/decisionLog/index.ts';
import { buildPlanLintCommand } from '#src/plan/draft/common/utils/buildPlanLintCommand.ts';
import { convergePlanStructure } from '#src/plan/draft/common/utils/convergePlanStructure.ts';
import { createDraftStop } from '#src/plan/draft/common/utils/createDraftStop.ts';
import { deleteAbandonedPlan } from '#src/plan/draft/common/utils/deleteAbandonedPlan.ts';
import { authorFocusedPlanFiles } from '#src/plan/draft/focused/common/utils/authorFocusedPlanFiles.ts';
import { renderDraftEvidenceBrief } from '#src/plan/draft/focused/common/utils/renderDraftEvidenceBrief.ts';
import { draftFocusedPhasedPlan } from '#src/plan/draft/focused/draftFocusedPhasedPlan.ts';
import { syncGlobalConstraints } from '#src/plan/sections/index.ts';

interface Params {
	context: DraftContext;
}

/**
 * Draft a single plan with the focused implementation, with one escape.
 *
 * It mirrors `draftSinglePlan` step for step and differs in four places: the
 * writer is handed the evidence the engine collected once instead of re-reading
 * source itself, `## Global Constraints` is composed from the decisions record
 * beside the Decision Log, the convergence runs the deterministic mechanical
 * repair before each round's lint, and the escalation goes to the focused phased
 * flow.
 *
 * Both engine section syncs run after the writer returns and before the
 * convergence, so the closing lint reads the sections the engine owns rather than
 * whatever the writer left. No `overviewPath` is passed to the convergence: a
 * standalone plan has no overview to render a phase table into.
 *
 * A single plan cannot be split by the structural repairer — the engine hands it
 * exactly one output path — so a busted created-file or touched-file ceiling is
 * the blocking finding that loop can never resolve. Rather than dead-ending on
 * a defect the engine can work out itself, the draft re-runs once as phased from
 * the same facts and decisions. The phased flow never escalates back, so the retry is
 * taken at most once, and only for these two checks.
 */
export const draftFocusedSinglePlan = async ({ context }: Params): Promise<RunPlanDraftResult> => {
	const { cwd, name, workspaceDir, decisions, evidence, progress } = context;
	const outputs = await planDraftOutputs({ cwd, name, variant: PlanVariant.Single });
	// Appended to once the closing lint has run, and read at every stop, so no
	// exit can be added that quietly drops what the human was told.
	const advisories: StructuralFinding[] = [];
	const draftStop = createDraftStop({ workspaceDir, advisories, implementation: context.implementation });
	const authored = await authorFocusedPlanFiles({
		context,
		outputs,
		step: 'draft',
		evidenceBrief: renderDraftEvidenceBrief({ evidence }),
		lint: buildPlanLintCommand({ cwd, name }),
		sync: buildPlanSyncDecisionsCommand({ cwd, name }),
	});

	if ('stop' in authored) {
		return authored.stop;
	}

	const { planPaths, report } = authored;

	// The writer was granted the same sync and may already have run it; the runner
	// rewrites a file only when its section differs, so this is then a no-op on
	// disk. It stands anyway, because a denied tool or a skipped self-lint must
	// not decide whether the plan the convergence lints carries current sections.
	await syncPlanDecisions({ cwd, name, planPaths, decisions });
	await syncGlobalConstraints({ planPaths, decisions });

	const converged = await convergePlanStructure({
		context,
		planPaths,
		variant: PlanVariant.Single,
		reports: [report],
		advisories,
		mechanicalRepair: true,
	});
	const overCeiling = converged.blocking.find(
		(finding) => finding.check === StructuralCheck.CreatedFilesWithinCeiling || finding.check === StructuralCheck.TouchedFilesWithinCeiling,
	);

	if (overCeiling) {
		progress(`plan draft ${name}: ${overCeiling.issue} — deleting ${outputs[0].path} and re-drafting phased`);

		const undeleted = await deleteAbandonedPlan({ path: outputs[0].path });

		return undeleted === undefined
			? draftFocusedPhasedPlan({ context, step: 'draft-overview' })
			: draftStop({ status: PlanRunStatus.Failed, error: undeleted });
	}

	return converged.result;
};
