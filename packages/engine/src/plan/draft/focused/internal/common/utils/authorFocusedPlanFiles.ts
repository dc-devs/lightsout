import { buildFocusedPlanWriterInvocation } from '#src/agents/buildFocusedPlanWriterInvocation/buildFocusedPlanWriterInvocation.ts';
import { createdFileCeiling } from '#src/common/constants/createdFileCeiling.ts';
import { touchedFileCeiling } from '#src/common/constants/touchedFileCeiling.ts';
import { PlanDraftReport } from '#src/contracts/plan/draft/PlanDraftReport.ts';
import { PlanDraftStatus } from '#src/contracts/plan/draft/PlanDraftStatus.ts';
import { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';
import { planWriterEnvironment } from '#src/plan/draft/internal/common/constants/planWriterEnvironment.ts';
import { createDraftStop } from '#src/plan/draft/internal/common/utils/createDraftStop.ts';
import type { planDraftOutputs } from '#src/plan/internal/common/paths/planDraftOutputs.ts';
import { verifyDraftedFiles } from '#src/plan/internal/common/paths/verifyDraftedFiles.ts';
import type { DraftContext } from '#src/plan/internal/common/types/DraftContext.ts';
import type { RunPlanDraftResult } from '#src/plan/internal/common/types/RunPlanDraftResult.ts';
import { createPlanAgentRunner } from '#src/plan/internal/common/utils/createPlanAgentRunner.ts';

interface Params {
	context: DraftContext;
	/** Where to write, and which template variant applies — the engine's paths, never the agent's. */
	outputs: Awaited<ReturnType<typeof planDraftOutputs>>;
	/** Names this spawn's transcript: `draft`, or `draft-overview` for the overview of a phased re-draft. */
	step: string;
	/** The engine's collected source evidence for this assignment, already rendered. */
	evidenceBrief: string;
	/** The self-lint command and the prefix it is granted. Absent on an overview spawn: no phase file exists yet, so the lint would only ever error. */
	lint?: { prefix: string; command: string };
	/** The Decision Log sync command and the prefix it is granted, run before the self-lint. Absent on an overview spawn for the same reason `lint` is. */
	sync?: { prefix: string; command: string };
}

/**
 * The focused plan-writer spawn and everything that can end the draft with it: an
 * agent that failed or rate-limited, a facts/decisions discrepancy the agent
 * found (not a drafting bug — the inputs are wrong, so surface it and never
 * loop), or files it claimed but did not write.
 *
 * The focused sibling of `authorPlanFiles`, differing in three places: the
 * invocation comes from the focused builder, the engine's rendered evidence
 * brief is threaded in, and the runner requests the focused environment.
 *
 * The granted command prefixes are computed exactly as legacy computes them —
 * the sync prefix then the lint prefix, in the order the writer runs them, and a
 * spawn granted nothing asks the harness for nothing. The focused environment
 * narrows the built-in tool set; it never touches this grant.
 */
export const authorFocusedPlanFiles = async ({
	context,
	outputs,
	step,
	evidenceBrief,
	lint,
	sync,
}: Params): Promise<{ stop: RunPlanDraftResult } | { planPaths: string[]; report: PlanDraftReport }> => {
	const { cwd, driver, name, workspaceDir, facts, decisions, executorFileLimit, standards, config, model, effort, permissions, timeoutMs } = context;
	// Nothing has been checked yet at any of this step's exits, so every one of
	// them carries an empty advisory set — stated once rather than four times.
	const draftStop = createDraftStop({ workspaceDir, advisories: [], implementation: context.implementation });
	const invokePlanAgent = createPlanAgentRunner({
		cwd,
		driver,
		workspaceDir,
		step,
		model,
		effort,
		permissions,
		timeoutMs,
		environment: planWriterEnvironment,
		level: context.level,
	});
	const grantedPrefixes = [sync?.prefix, lint?.prefix].filter((prefix) => prefix !== undefined);
	const outcome = await invokePlanAgent({
		invocation: buildFocusedPlanWriterInvocation({
			facts,
			decisions,
			outputs,
			limits: { executorFileLimit, createdFileCeiling, touchedFileCeiling },
			standards,
			lintCommand: lint?.command,
			syncCommand: sync?.command,
			docs: config?.docs,
			contract: config?.plan?.contract,
			evidenceBrief,
		}),
		contract: PlanDraftReport,
		allowedCommands: grantedPrefixes.length > 0 ? grantedPrefixes : undefined,
	});

	if (!outcome.ok) {
		return {
			stop: outcome.rateLimited
				? draftStop({ status: PlanRunStatus.PausedRateLimit, error: `rate limited or overloaded — re-run: lightsout plan draft --name ${name}` })
				: draftStop({ status: PlanRunStatus.Failed, error: outcome.failure }),
		};
	}

	const { report } = outcome;

	if (report.status === PlanDraftStatus.Error) {
		return { stop: draftStop({ status: PlanRunStatus.FactsError, discrepancies: report.discrepancies }) };
	}

	const drafted = await verifyDraftedFiles({ cwd, filesWritten: report.filesWritten });

	if ('error' in drafted) {
		return { stop: draftStop({ status: PlanRunStatus.Failed, error: drafted.error }) };
	}

	return { planPaths: drafted.planPaths, report };
};
