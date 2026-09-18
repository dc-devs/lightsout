import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { type DecisionsRecord, PlanVariant, type StructuralFinding } from '#src/contracts/index.ts';
import { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';
import { planDraftOutputs } from '#src/plan/common/paths/planDraftOutputs.ts';
import type { DraftContext } from '#src/plan/common/types/DraftContext.ts';
import type { RunPlanDraftResult } from '#src/plan/common/types/RunPlanDraftResult.ts';
import { getBlockingFindings } from '#src/plan/common/utils/getBlockingFindings.ts';
import { syncPlanDecisions } from '#src/plan/decisionLog/index.ts';
import { convergePlanStructure } from '#src/plan/draft/common/utils/convergePlanStructure.ts';
import { createDraftStop } from '#src/plan/draft/common/utils/createDraftStop.ts';
import { getAdvisoryFindings } from '#src/plan/draft/common/utils/getAdvisoryFindings.ts';
import { stopForPhaseFailure } from '#src/plan/draft/common/utils/stopForPhaseFailure.ts';
import { authorFocusedPhaseFiles } from '#src/plan/draft/focused/authorFocusedPhaseFiles.ts';
import { authorFocusedPlanFiles } from '#src/plan/draft/focused/common/utils/authorFocusedPlanFiles.ts';
import { renderDraftEvidenceBrief } from '#src/plan/draft/focused/common/utils/renderDraftEvidenceBrief.ts';
import { repairPhaseBreakdown } from '#src/plan/draft/repairPhaseBreakdown.ts';
import { stampPhaseCounts } from '#src/plan/draft/stampPhaseCounts.ts';
import { parsePhaseDeclarations } from '#src/plan/parsePhaseDeclarations.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';
import { syncGlobalConstraints, syncPhaseSections } from '#src/plan/sections/index.ts';

interface Params {
	context: DraftContext;
	/** Names the overview spawn's transcript — `draft`, or `draft-overview` when this is a re-draft of an abandoned single plan. */
	step: string;
}

/**
 * The deterministic door check on the breakdown the overview declares, and the
 * overview text the phase writers are then authored against — or the stop that
 * ends the draft before a single phase spawn is paid for.
 *
 * The overview is re-synced after the check because a reshape round rewrites
 * `overview.md`, and a phase writer authors against the text in its prompt
 * rather than the file: sections composed only on disk would still fan out stale.
 */
const readCheckedBreakdown = async ({
	params,
	decisions,
	advisories,
	draftStop,
}: {
	params: Parameters<typeof repairPhaseBreakdown>[0];
	decisions: DecisionsRecord;
	advisories: StructuralFinding[];
	draftStop: ReturnType<typeof createDraftStop>;
	// Stated rather than inferred: the inferred union gives the phase branch an
	// optional `stop`, which leaves `'stop' in checked` narrowing to both halves.
}): Promise<{ stop: RunPlanDraftResult } | { overviewText: string; declarations: ReturnType<typeof parsePhaseDeclarations> }> => {
	const { cwd, name, overviewPath } = params;
	const breakdown = await repairPhaseBreakdown(params);

	if (breakdown.status === PlanRunStatus.PausedRateLimit) {
		return { stop: draftStop({ status: PlanRunStatus.PausedRateLimit, error: breakdown.error }) };
	}

	if (breakdown.status === PlanRunStatus.Failed) {
		return { stop: draftStop({ status: PlanRunStatus.Failed, error: breakdown.error }) };
	}

	advisories.push(...getAdvisoryFindings({ findings: breakdown.findings }));

	if (getBlockingFindings({ findings: breakdown.findings }).length > 0) {
		return { stop: draftStop({ status: PlanRunStatus.StructuralIssues, findings: breakdown.findings, planPaths: [overviewPath] }) };
	}

	await syncPlanDecisions({ cwd, name, planPaths: [overviewPath], decisions });
	await syncGlobalConstraints({ planPaths: [overviewPath], decisions });

	const overviewText = await readFile(overviewPath, 'utf8');

	return { overviewText, declarations: parsePhaseDeclarations({ plan: parsePlan({ content: overviewText, base: basename(overviewPath) }) }) };
};

/**
 * Compose every section the engine owns across a finished phased deliverable,
 * in the one order they may run in.
 *
 * The Decision Log and the Global Constraints come from the saved records, so
 * they can be written as soon as the phase files exist. The counts cannot: the
 * overview's were an estimate made before any phase file was on disk, and only
 * the stamp turns them into a fact. The paired `## Phases` row and
 * `### Phase <N> — ` heading are rendered from the record the stamp returns, so
 * rendering them ahead of it would write the overview agent's estimate straight
 * back over the real counts.
 */
const composeEngineSections = async ({
	cwd,
	name,
	overviewPath,
	phasePaths,
	decisions,
}: {
	cwd: string;
	name: string;
	overviewPath: string;
	phasePaths: string[];
	decisions: DecisionsRecord;
}) => {
	await syncPlanDecisions({ cwd, name, planPaths: phasePaths, decisions });
	await syncGlobalConstraints({ planPaths: [overviewPath, ...phasePaths], decisions });

	const stamped = await stampPhaseCounts({ overviewPath, phasePaths });

	await syncPhaseSections({ overviewPath, declarations: stamped, phaseFiles: phasePaths.map((path) => basename(path)) });
};

/**
 * Draft a phased plan with the focused implementation: an overview spawn, a
 * deterministic door check on the breakdown it declares, then one concurrent
 * spawn per declared phase, and the usual structural repair over the finished
 * set.
 *
 * It mirrors `draftPhasedPlan` step for step and differs in five places: the
 * overview spawn carries the draft's evidence brief, `## Global Constraints` is
 * composed beside every Decision Log sync, the paired `## Phases` row and
 * `### Phase <N> — ` declaration heading are rendered from one record straight
 * after the counts are stamped, the fan-out is the focused one, and the
 * convergence runs the deterministic mechanical repair before each round's lint.
 *
 * Three orderings are load-bearing. The door check runs before any phase spawn is
 * paid for, because that is the cheapest moment to refuse an unbuildable phase.
 * The overview is re-synced after it, because a reshape round rewrites
 * `overview.md` while a phase writer authors against the text in its prompt. And
 * `syncPhaseSections` runs after the counts are stamped rather than before,
 * because the stamp is what turns the overview's estimate into the fact that
 * section renders.
 *
 * The overview spawn gets no self-lint, because at the end of it no phase file
 * exists and `resolvePlanDeliverable` would answer `no plan found` — handing an
 * agent a command that always errors teaches it to ignore the section.
 *
 * A phase that busts the created-file ceiling here — legitimate, since the
 * declared counts were an estimate and the declaration a floor — surfaces as a
 * blocking finding from the closing lint and, unresolved, hands back. It is
 * deliberately NOT escalated to another breakdown reshape: re-splitting would
 * invalidate every phase file already authored, paying for the whole fan-out
 * twice to fix one phase.
 */
export const draftFocusedPhasedPlan = async ({ context, step }: Params): Promise<RunPlanDraftResult> => {
	const { cwd, driver, name, workspaceDir, facts, decisions, brainstormDecisionsPath, config, executorFileLimit, evidence } = context;
	const { standards, model, effort, permissions, timeoutMs, level, progress } = context;
	const outputs = await planDraftOutputs({ cwd, name, variant: PlanVariant.Overview });
	const overviewPath = outputs[0].path;
	// Appended to as each check reports, and read at every stop: a breakdown
	// warning gates nothing, but it is the human's only notice of what reviewing
	// this plan will cost them, so it has to ride whichever way the draft ends.
	const advisories: StructuralFinding[] = [];
	// A focused context always carries evidence; the empty index is what a context wired without a collection narrows to.
	const collected = evidence ?? { planName: name, entries: [], collectedAt: new Date().toISOString() };
	const draftStop = createDraftStop({ workspaceDir, advisories, implementation: context.implementation });
	const authored = await authorFocusedPlanFiles({
		context,
		outputs,
		step,
		evidenceBrief: renderDraftEvidenceBrief({ evidence }),
	});

	if ('stop' in authored) {
		return authored.stop;
	}

	// By path rather than by deliverable: the folder holds only overview.md at
	// this moment, which `resolvePlanDeliverable` reads as no plan found.
	await syncPlanDecisions({ cwd, name, planPaths: [overviewPath], decisions });
	await syncGlobalConstraints({ planPaths: [overviewPath], decisions });

	const spawn = { cwd, driver, name, workspaceDir, model, effort, permissions, timeoutMs, level, progress };
	const checked = await readCheckedBreakdown({
		params: { ...spawn, overviewPath, brainstormDecisionsPath, executorFileLimit },
		decisions,
		advisories,
		draftStop,
	});

	if ('stop' in checked) {
		return checked.stop;
	}

	const phases = await authorFocusedPhaseFiles({
		...spawn,
		facts,
		decisions,
		overviewText: checked.overviewText,
		declarations: checked.declarations,
		evidence: collected,
		executorFileLimit,
		standards,
		docs: config?.docs,
		contract: config?.plan?.contract,
	});

	if (phases.status !== PlanRunStatus.Complete) {
		return stopForPhaseFailure({ phases, draftStop });
	}

	// Every plan file carries the engine's own sections before anything reads them:
	// the stamp inside, and the closing lint after.
	await composeEngineSections({ cwd, name, overviewPath, phasePaths: phases.planPaths, decisions });

	const converged = await convergePlanStructure({
		context,
		planPaths: [overviewPath, ...phases.planPaths],
		variant: PlanVariant.Overview,
		reports: [authored.report, ...phases.reports],
		advisories,
		mechanicalRepair: true,
		overviewPath,
	});

	return converged.result;
};
