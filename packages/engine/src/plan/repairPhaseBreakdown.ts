import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { buildPlanReshapeInvocation } from '#src/agents/index.ts';
import { createdFileCeiling } from '#src/common/constants/createdFileCeiling.ts';
import { type Effort, type Permissions, PlanFixReport, type StructuralFinding } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { checkPhaseBreakdown } from '#src/plan/checkPhaseBreakdown.ts';
import type { PlanRepairResult } from '#src/plan/common/types/PlanRepairResult.ts';
import { convergeFindings } from '#src/plan/common/utils/convergeFindings.ts';
import { createPlanAgentRunner } from '#src/plan/common/utils/createPlanAgentRunner.ts';

interface Params {
	cwd: string;
	driver: Driver;
	/** Kebab plan name — narrated in progress lines and in the parked re-run command. */
	name: string;
	/** Absolute path of the overview the reshaper may edit in place. */
	overviewPath: string;
	/** The plan's workspace: reshape transcripts, facts and decisions live here. */
	workspaceDir: string;
	/** Absolute path of the workspace's brainstorm-decisions.json when one exists. */
	brainstormDecisionsPath?: string;
	/** `executor-file-limit` from config, already defaulted. */
	executorFileLimit: number;
	model?: string;
	effort?: Effort;
	permissions?: Permissions;
	timeoutMs: number;
	progress: (message: string) => void;
}

/** The breakdown as it stands on disk, or nothing when the overview cannot be read — a spawn that claimed to write it and did not. */
const checkOverviewOnDisk = async ({ overviewPath, executorFileLimit }: { overviewPath: string; executorFileLimit: number }) => {
	const overviewText = await readFile(overviewPath, 'utf8').catch(() => undefined);

	return overviewText === undefined ? undefined : checkPhaseBreakdown({ overviewText, overviewBase: basename(overviewPath), executorFileLimit });
};

/**
 * One reshape round: its own agent runner, so each attempt keeps its own
 * transcript, pointed at the blocking findings alongside the decisions and facts
 * the overview was written from.
 */
const runReshapeAttempt = ({ params, findings, attempt }: { params: Params; findings: StructuralFinding[]; attempt: number }) => {
	const { cwd, driver, overviewPath, workspaceDir, brainstormDecisionsPath, model, effort, permissions, timeoutMs } = params;
	const invokePlanAgent = createPlanAgentRunner({
		cwd,
		driver,
		workspaceDir,
		step: `breakdown-repair-${attempt}`,
		model,
		effort,
		permissions,
		timeoutMs,
	});

	return invokePlanAgent({
		invocation: buildPlanReshapeInvocation({
			findings,
			planPaths: [overviewPath],
			createdFileCeiling,
			decisionsPath: join(workspaceDir, 'decisions.json'),
			brainstormDecisionsPath,
			factsPath: join(workspaceDir, 'facts.json'),
		}),
		contract: PlanFixReport,
	});
};

/**
 * Converge a freshly-authored overview's phase breakdown: each blocking
 * breakdown finding is corrected by a reshape invocation that edits the overview
 * in place, re-checked after each. A `complete` result carries the surviving
 * findings — empty when the breakdown converged — so the caller decides what a
 * survivor means.
 *
 * Keeping the common case unattended is the point: a breakdown that cannot be
 * made to fit still stops the run, but one an agent can reshape does not cost a
 * human a round trip. It runs before a single phase file is drafted, which is
 * the cheapest moment a plan can be refused.
 */
export const repairPhaseBreakdown = async (params: Params): Promise<PlanRepairResult> => {
	const { name, overviewPath, executorFileLimit, progress } = params;

	return convergeFindings({
		name,
		verb: 'reshape',
		findingNoun: 'phase-breakdown finding(s)',
		check: () => checkOverviewOnDisk({ overviewPath, executorFileLimit }),
		unreadableError: `overview could not be read at ${overviewPath}`,
		runAttempt: ({ findings, attempt }) => runReshapeAttempt({ params, findings, attempt }),
		progress,
	});
};
