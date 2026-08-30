import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { PlanVariant, type StructuralFinding } from '#src/contracts/index.ts';
import { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';
import { planDraftOutputs } from '#src/plan/common/paths/planDraftOutputs.ts';
import type { DraftContext } from '#src/plan/common/types/DraftContext.ts';
import type { RunPlanDraftResult } from '#src/plan/common/types/RunPlanDraftResult.ts';
import { getBlockingFindings } from '#src/plan/common/utils/getBlockingFindings.ts';
import { authorPhaseFiles } from '#src/plan/draft/authorPhaseFiles.ts';
import { authorPlanFiles } from '#src/plan/draft/common/utils/authorPlanFiles.ts';
import { convergePlanStructure } from '#src/plan/draft/common/utils/convergePlanStructure.ts';
import { createDraftStop } from '#src/plan/draft/common/utils/createDraftStop.ts';
import { getAdvisoryFindings } from '#src/plan/draft/common/utils/getAdvisoryFindings.ts';
import { repairPhaseBreakdown } from '#src/plan/draft/repairPhaseBreakdown.ts';
import { stampPhaseCounts } from '#src/plan/draft/stampPhaseCounts.ts';
import { parsePhaseDeclarations } from '#src/plan/parsePhaseDeclarations.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';

interface Params {
	context: DraftContext;
	/** Names the overview spawn's transcript — `draft`, or `draft-overview` when this is a re-draft of an abandoned single plan. */
	step: string;
}

/**
 * Draft a phased plan: an overview spawn, a deterministic door check on the
 * breakdown it declares, then one concurrent spawn per declared phase, and the
 * usual structural repair over the finished set.
 *
 * The overview spawn gets no self-lint, because at the end of it no phase file
 * exists and `resolvePlanDeliverable` would answer `no plan found` — handing an
 * agent a command that always errors teaches it to ignore the section. The
 * breakdown check covers the overview instead, deterministically and without an
 * agent, at the cheapest possible moment: before a single phase spawn is paid
 * for.
 *
 * A phase that busts the created-file ceiling here — legitimate, since the
 * declared counts were an estimate and the declaration a floor — surfaces as a
 * blocking finding from the closing lint and, unresolved, hands back. It is
 * deliberately NOT escalated to another breakdown reshape: re-splitting would
 * invalidate every phase file already authored, paying for the whole fan-out
 * twice to fix one phase.
 */
export const draftPhasedPlan = async ({ context, step }: Params): Promise<RunPlanDraftResult> => {
	const { cwd, driver, name, workspaceDir, facts, decisions, brainstormDecisionsPath, config, executorFileLimit } = context;
	const { standards, model, effort, permissions, timeoutMs, progress } = context;
	const outputs = planDraftOutputs({ cwd, name, variant: PlanVariant.Overview });
	const overviewPath = outputs[0].path;
	// Appended to as each check reports, and read at every stop: a breakdown
	// warning gates nothing, but it is the human's only notice of what reviewing
	// this plan will cost them, so it has to ride whichever way the draft ends.
	const advisories: StructuralFinding[] = [];
	const draftStop = createDraftStop({ workspaceDir, advisories });
	const authored = await authorPlanFiles({ context, outputs, step });

	if ('stop' in authored) {
		return authored.stop;
	}

	const spawn = { cwd, driver, name, workspaceDir, model, effort, permissions, timeoutMs, progress };
	const breakdown = await repairPhaseBreakdown({ ...spawn, overviewPath, brainstormDecisionsPath, executorFileLimit });

	if (breakdown.status === PlanRunStatus.PausedRateLimit) {
		return draftStop({ status: PlanRunStatus.PausedRateLimit, error: breakdown.error });
	}

	if (breakdown.status === PlanRunStatus.Failed) {
		return draftStop({ status: PlanRunStatus.Failed, error: breakdown.error });
	}

	advisories.push(...getAdvisoryFindings({ findings: breakdown.findings }));

	if (getBlockingFindings({ findings: breakdown.findings }).length > 0) {
		return draftStop({ status: PlanRunStatus.StructuralIssues, findings: breakdown.findings, planPaths: [overviewPath] });
	}

	const overviewText = await readFile(overviewPath, 'utf8');
	const declarations = parsePhaseDeclarations({ plan: parsePlan({ content: overviewText, base: basename(overviewPath) }) });
	const phases = await authorPhaseFiles({ ...spawn, facts, decisions, overviewText, declarations, executorFileLimit, standards, docs: config?.docs });

	if (phases.status === PlanRunStatus.FactsError) {
		return draftStop({ status: PlanRunStatus.FactsError, discrepancies: phases.discrepancies });
	}

	if (phases.status === PlanRunStatus.PausedRateLimit) {
		return draftStop({ status: PlanRunStatus.PausedRateLimit, error: phases.error });
	}

	if (phases.status === PlanRunStatus.Failed) {
		return draftStop({ status: PlanRunStatus.Failed, error: phases.error });
	}

	// The overview's counts were an estimate made before any phase file existed;
	// now they are a fact the engine can state, so the consistency check goes
	// back to catching drift instead of spending agent attempts on arithmetic.
	await stampPhaseCounts({ overviewPath, phasePaths: phases.planPaths });

	const converged = await convergePlanStructure({
		context,
		planPaths: [overviewPath, ...phases.planPaths],
		variant: PlanVariant.Overview,
		reports: [authored.report, ...phases.reports],
		advisories,
	});

	return converged.result;
};
