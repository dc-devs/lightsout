import { rm } from 'node:fs/promises';
import { PlanVariant, StructuralCheck, type StructuralFinding } from '#src/contracts/index.ts';
import { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';
import { pathExists } from '#src/plan/common/paths/pathExists.ts';
import { planDraftOutputs } from '#src/plan/common/paths/planDraftOutputs.ts';
import type { DraftContext } from '#src/plan/common/types/DraftContext.ts';
import type { RunPlanDraftResult } from '#src/plan/common/types/RunPlanDraftResult.ts';
import { authorPlanFiles } from '#src/plan/common/utils/authorPlanFiles.ts';
import { buildPlanLintCommand } from '#src/plan/common/utils/buildPlanLintCommand.ts';
import { convergePlanStructure } from '#src/plan/common/utils/convergePlanStructure.ts';
import { createDraftStop } from '#src/plan/common/utils/createDraftStop.ts';
import { draftPhasedPlan } from '#src/plan/draftPhasedPlan.ts';

interface Params {
	context: DraftContext;
}

/**
 * Delete the abandoned single draft before a phased re-draft, returning the
 * reason it could not be, if it could not.
 *
 * Not tidiness: `resolvePlanDeliverable` short-circuits on `plan.md` existing
 * and never looks for `overview.md` or the phase files when it does, so a
 * surviving single draft would shadow the phased plan entirely — grade, dedup
 * and implement would all read the abandoned file and never see the phases. Its
 * transcript stays in place under `draft-stream.jsonl` and the second overview
 * spawn writes its own, so the evidence of both attempts survives.
 */
const deleteAbandonedPlan = async ({ path }: { path: string }) => {
	await rm(path, { force: true }).catch(() => undefined);

	return (await pathExists({ path })) ? `the abandoned single draft could not be deleted at ${path}` : undefined;
};

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
	const { cwd, name, workspaceDir, progress } = context;
	const outputs = planDraftOutputs({ cwd, name, variant: PlanVariant.Single });
	// Appended to once the closing lint has run, and read at every stop, so no
	// exit can be added that quietly drops what the human was told.
	const advisories: StructuralFinding[] = [];
	const draftStop = createDraftStop({ workspaceDir, advisories });
	const authored = await authorPlanFiles({ context, outputs, step: 'draft', lint: buildPlanLintCommand({ cwd, name }) });

	if ('stop' in authored) {
		return authored.stop;
	}

	const { planPaths, report } = authored;
	const converged = await convergePlanStructure({ context, planPaths, variant: PlanVariant.Single, reports: [report], advisories });
	const overCeiling = converged.blocking.find((finding) => finding.check === StructuralCheck.CreatedFilesWithinCeiling);

	if (overCeiling) {
		progress(`plan draft ${name}: ${overCeiling.issue} — deleting ${outputs[0].path} and re-drafting phased`);

		const undeleted = await deleteAbandonedPlan({ path: outputs[0].path });

		return undeleted === undefined ? draftPhasedPlan({ context, step: 'draft-overview' }) : draftStop({ status: PlanRunStatus.Failed, error: undeleted });
	}

	return converged.result;
};
