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
import { authorPlanFiles } from '#src/plan/draft/legacy/common/utils/authorPlanFiles.ts';
import { draftPhasedPlan } from '#src/plan/draft/legacy/draftPhasedPlan.ts';

interface Params {
	context: DraftContext;
}

/**
 * Draft a single plan, with one escape.
 *
 * A single plan cannot be split by the structural repairer — the engine hands it
 * exactly one output path — so a busted created-file ceiling is the one blocking
 * finding that loop can never resolve. Rather than dead-ending on a defect the
 * engine can work out itself, the draft re-runs once as phased from the same
 * facts and decisions. That is reachable in ordinary use: the scope estimate
 * counts only the paths the verified facts name, and those carry no
 * create-paths, so a plan estimated as comfortably single can still author forty
 * new files. The phased flow never escalates back, so the retry is taken at most
 * once, and only for this one check — every other structural defect is the
 * repair loop's job.
 */
export const draftSinglePlan = async ({ context }: Params): Promise<RunPlanDraftResult> => {
	const { cwd, name, workspaceDir, decisions, progress } = context;
	const outputs = planDraftOutputs({ cwd, name, variant: PlanVariant.Single });
	// Appended to once the closing lint has run, and read at every stop, so no
	// exit can be added that quietly drops what the human was told.
	const advisories: StructuralFinding[] = [];
	const draftStop = createDraftStop({ workspaceDir, advisories, implementation: context.implementation });
	const authored = await authorPlanFiles({
		context,
		outputs,
		step: 'draft',
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
	// not decide whether the plan the convergence lints carries a current log.
	await syncPlanDecisions({ cwd, name, planPaths, decisions });

	const converged = await convergePlanStructure({ context, planPaths, variant: PlanVariant.Single, reports: [report], advisories });
	const overCeiling = converged.blocking.find((finding) => finding.check === StructuralCheck.CreatedFilesWithinCeiling);

	if (overCeiling) {
		progress(`plan draft ${name}: ${overCeiling.issue} — deleting ${outputs[0].path} and re-drafting phased`);

		const undeleted = await deleteAbandonedPlan({ path: outputs[0].path });

		return undeleted === undefined ? draftPhasedPlan({ context, step: 'draft-overview' }) : draftStop({ status: PlanRunStatus.Failed, error: undeleted });
	}

	return converged.result;
};
