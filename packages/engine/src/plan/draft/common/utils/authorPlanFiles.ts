import { buildPlanWriterInvocation } from '#src/agents/index.ts';
import { createdFileCeiling } from '#src/common/constants/createdFileCeiling.ts';
import { PlanDraftReport, PlanDraftStatus } from '#src/contracts/index.ts';
import { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';
import type { planDraftOutputs } from '#src/plan/common/paths/planDraftOutputs.ts';
import { verifyDraftedFiles } from '#src/plan/common/paths/verifyDraftedFiles.ts';
import type { DraftContext } from '#src/plan/common/types/DraftContext.ts';
import type { RunPlanDraftResult } from '#src/plan/common/types/RunPlanDraftResult.ts';
import { createPlanAgentRunner } from '#src/plan/common/utils/createPlanAgentRunner.ts';
import { createDraftStop } from '#src/plan/draft/common/utils/createDraftStop.ts';

interface Params {
	context: DraftContext;
	/** Where to write, and which template variant applies — the engine's paths, never the agent's. */
	outputs: ReturnType<typeof planDraftOutputs>;
	/** Names this spawn's transcript: `draft`, or `draft-overview` for the overview of a phased re-draft. */
	step: string;
	/** The self-lint command and the prefix it is granted. Absent on an overview spawn: no phase file exists yet, so the lint would only ever error. */
	lint?: { prefix: string; command: string };
	/** The Decision Log sync command and the prefix it is granted, run before the self-lint. Absent on an overview spawn for the same reason `lint` is: no deliverable resolves yet. */
	sync?: { prefix: string; command: string };
}

/**
 * The plan-writer spawn and everything that can end the draft with it: an agent
 * that failed or rate-limited, a facts/decisions discrepancy the agent found
 * (not a drafting bug — the inputs are wrong, so surface it and never loop), or
 * files it claimed but did not write.
 *
 * Shared by both draft flows because both open the same way: one spawn, one
 * dictated path, one verified write. What differs is only which file it is asked
 * for and whether it may self-lint.
 */
export const authorPlanFiles = async ({
	context,
	outputs,
	step,
	lint,
	sync,
}: Params): Promise<{ stop: RunPlanDraftResult } | { planPaths: string[]; report: PlanDraftReport }> => {
	const { cwd, driver, name, workspaceDir, facts, decisions, executorFileLimit, standards, config, model, effort, permissions, timeoutMs } = context;
	// Nothing has been checked yet at any of this step's exits, so every one of
	// them carries an empty advisory set — stated once rather than four times.
	const draftStop = createDraftStop({ workspaceDir, advisories: [] });
	const invokePlanAgent = createPlanAgentRunner({ cwd, driver, workspaceDir, step, model, effort, permissions, timeoutMs });
	// In the order the writer runs them, and only the ones this spawn was given:
	// a spawn granted nothing at all asks the harness for nothing at all.
	const grantedPrefixes = [sync?.prefix, lint?.prefix].filter((prefix) => prefix !== undefined);
	const outcome = await invokePlanAgent({
		invocation: buildPlanWriterInvocation({
			facts,
			decisions,
			outputs,
			limits: { executorFileLimit, createdFileCeiling },
			standards,
			lintCommand: lint?.command,
			syncCommand: sync?.command,
			docs: config?.docs,
			contract: config?.plan?.contract,
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
