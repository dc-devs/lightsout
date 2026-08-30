import { join } from 'node:path';
import { buildPlanRepairInvocation } from '#src/agents/index.ts';
import { type Effort, type LightsoutConfig, type Permissions, PlanFixReport, type StructuralFinding } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { PlanRepairResult } from '#src/plan/common/types/PlanRepairResult.ts';
import { createPlanAgentRunner } from '#src/plan/common/utils/createPlanAgentRunner.ts';
import { convergeFindings } from '#src/plan/draft/common/utils/convergeFindings.ts';
import { lintPlanStructure } from '#src/plan/lint/index.ts';

interface Params {
	cwd: string;
	driver: Driver;
	/** Kebab plan name — narrated in progress lines and in the parked re-run command. */
	name: string;
	/** Absolute paths to the drafted plan file(s) the repairer may edit in place. */
	planPaths: string[];
	/** The plan's workspace dir: repair transcripts land here, as do the facts/decisions the repairer is pointed at. */
	workspaceDir: string;
	/** Absolute path of the workspace's brainstorm-decisions.json when one exists — the repairer Reads it alongside the plan's own decisions. */
	brainstormDecisionsPath?: string;
	config?: LightsoutConfig;
	model?: string;
	effort?: Effort;
	permissions?: Permissions;
	timeoutMs: number;
	progress: (message: string) => void;
}

/**
 * One repair round: its own agent runner, so each attempt keeps its own
 * transcript under the name the workspace already uses, pointed at the blocking
 * findings alongside the decisions and facts the plan was written from.
 */
const runRepairAttempt = ({ params, findings, attempt }: { params: Params; findings: StructuralFinding[]; attempt: number }) => {
	const { cwd, driver, planPaths, workspaceDir, brainstormDecisionsPath, config, model, effort, permissions, timeoutMs } = params;
	const invokePlanAgent = createPlanAgentRunner({ cwd, driver, workspaceDir, step: `repair-${attempt}`, model, effort, permissions, timeoutMs });

	return invokePlanAgent({
		invocation: buildPlanRepairInvocation({
			findings,
			planPaths,
			decisionsPath: join(workspaceDir, 'decisions.json'),
			brainstormDecisionsPath,
			factsPath: join(workspaceDir, 'facts.json'),
			docs: config?.docs,
		}),
		contract: PlanFixReport,
	});
};

/**
 * Lint a drafted plan's structure and converge it: each lint failure is
 * corrected by a small repair invocation that Edits the draft in place against
 * the typed findings (the `invokeAgentWithContract` re-emit philosophy applied
 * at the lint level), re-linting after each.
 *
 * The lint always answers, so the unreadable-inputs exit `convergeFindings`
 * offers is unreachable here: a plan file the repairer deleted or broke comes
 * back as a finding rather than as no answer at all.
 */
export const repairPlanStructure = async (params: Params): Promise<PlanRepairResult> => {
	const { cwd, name, planPaths, config, progress } = params;

	return convergeFindings({
		name,
		verb: 'repair',
		findingNoun: 'structural finding(s)',
		check: () => lintPlanStructure({ cwd, planPaths, config }),
		unreadableError: `the plan file(s) could not be linted at ${planPaths.join(', ')}`,
		runAttempt: ({ findings, attempt }) => runRepairAttempt({ params, findings, attempt }),
		progress,
	});
};
