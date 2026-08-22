import type { PlanDraftReport, PlanVariant, StructuralFinding } from '#src/contracts/index.ts';
import { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';
import type { DraftContext } from '#src/plan/common/types/DraftContext.ts';
import type { RunPlanDraftResult } from '#src/plan/common/types/RunPlanDraftResult.ts';
import { createDraftStop } from '#src/plan/common/utils/createDraftStop.ts';
import { getAdvisoryFindings } from '#src/plan/common/utils/getAdvisoryFindings.ts';
import { getBlockingFindings } from '#src/plan/common/utils/getBlockingFindings.ts';
import { repairPlanStructure } from '#src/plan/repairPlanStructure.ts';

interface Params {
	context: DraftContext;
	/** Every file the draft authored — the whole set, because a cross-phase finding needs two files in view. */
	planPaths: string[];
	/** The variant a converged draft reports it came out as. */
	variant: PlanVariant;
	/** One report per spawn, in spawn order — the overview's first on a phased draft. */
	reports: PlanDraftReport[];
	/** Accumulated advisories, appended to by this step and read at whichever exit it produces. */
	advisories: StructuralFinding[];
}

/**
 * The closing move of both draft flows: converge the authored set with
 * `repairPlanStructure` and fold its outcome into the draft's own result — a
 * dead spawn, a rate-limit park, blocking findings handed back, or a clean plan.
 *
 * Spelled once because both flows end identically, and an exit shape that is
 * hand-written twice is one edit away from the two ending differently for no
 * stated reason.
 *
 * The blocking findings come back beside the result because one caller acts on
 * them rather than returning them: a single plan busting the created-file
 * ceiling is the one finding the structural repairer can never resolve — it is
 * handed exactly one output path and cannot split a plan — so the single flow
 * escalates to a phased re-draft instead of handing it to the human.
 */
export const convergePlanStructure = async ({
	context,
	planPaths,
	variant,
	reports,
	advisories,
}: Params): Promise<{ result: RunPlanDraftResult; blocking: StructuralFinding[] }> => {
	const { cwd, driver, name, workspaceDir, brainstormDecisionsPath, config, model, effort, permissions, timeoutMs, progress } = context;
	const draftStop = createDraftStop({ workspaceDir, advisories });
	const repaired = await repairPlanStructure({
		cwd,
		driver,
		name,
		planPaths,
		workspaceDir,
		brainstormDecisionsPath,
		config,
		model,
		effort,
		permissions,
		timeoutMs,
		progress,
	});

	if (repaired.status === PlanRunStatus.PausedRateLimit) {
		return { result: draftStop({ status: PlanRunStatus.PausedRateLimit, error: repaired.error }), blocking: [] };
	}

	if (repaired.status === PlanRunStatus.Failed) {
		return { result: draftStop({ status: PlanRunStatus.Failed, error: repaired.error }), blocking: [] };
	}

	advisories.push(...getAdvisoryFindings({ findings: repaired.findings }));

	const blocking = getBlockingFindings({ findings: repaired.findings });

	if (blocking.length > 0) {
		return { result: draftStop({ status: PlanRunStatus.StructuralIssues, findings: repaired.findings, planPaths }), blocking };
	}

	progress(`plan draft ${name}: structurally clean (${planPaths.length} file(s))`);

	return { result: draftStop({ status: PlanRunStatus.Complete, planPaths, variant, reports }), blocking };
};
