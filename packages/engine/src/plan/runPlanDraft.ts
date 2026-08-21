import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { buildPlanWriterInvocation } from '#src/agents/index.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import {
	type DecisionsRecord,
	type Effort,
	type Permissions,
	PlanDraftReport,
	PlanDraftStatus,
	type PlanVariant,
	type StructuralFinding,
} from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';
import { planDraftOutputs } from '#src/plan/common/paths/planDraftOutputs.ts';
import { verifyDraftedFiles } from '#src/plan/common/paths/verifyDraftedFiles.ts';
import { buildPlanLintCommand } from '#src/plan/common/utils/buildPlanLintCommand.ts';
import { createPlanAgentRunner } from '#src/plan/common/utils/createPlanAgentRunner.ts';
import { estimatePlanScope } from '#src/plan/estimatePlanScope.ts';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';
import { readBrainstormDecisions } from '#src/plan/readBrainstormDecisions.ts';
import { readDecisions } from '#src/plan/readDecisions.ts';
import { readPlanFacts } from '#src/plan/readPlanFacts.ts';
import { repairPlanStructure } from '#src/plan/repairPlanStructure.ts';

interface Params {
	cwd: string;
	driver: Driver;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
	/** Force a variant; otherwise it is estimated from the facts' touched-file count. */
	scope?: PlanVariant;
	/** Supplemental code standards, threaded into the plan-writer invocation. */
	standards?: string;
	model?: string;
	effort?: Effort;
	permissions?: Permissions;
	timeoutMs?: number;
	onProgress?: (message: string) => void;
}

type RunPlanDraftResult =
	| { status: typeof PlanRunStatus.Complete; workspaceDir: string; planPaths: string[]; variant: PlanVariant; report: PlanDraftReport }
	| { status: typeof PlanRunStatus.Failed; workspaceDir: string; error: string }
	| { status: typeof PlanRunStatus.PausedRateLimit; workspaceDir: string; error: string }
	| { status: typeof PlanRunStatus.FactsError; workspaceDir: string; discrepancies: string[] }
	| { status: typeof PlanRunStatus.StructuralIssues; workspaceDir: string; findings: StructuralFinding[]; planPaths: string[] };

/**
 * The rows the plan writer renders, with brainstorm's settled ones first: they
 * were settled first, and the writer renders the Decision Log in the order it
 * receives. Brainstorm rows are merged at read time so the plan's own
 * `decisions.json` stays plan-owned.
 */
const readMergedDecisions = async ({ cwd, name, progress }: { cwd: string; name: string; progress: (message: string) => void }) => {
	const decisions = await readDecisions({ cwd, name });
	const brainstorm = await readBrainstormDecisions({ cwd, name });
	const merged: DecisionsRecord = brainstorm ? { ...decisions, decisions: [...brainstorm.decisions, ...decisions.decisions] } : decisions;

	progress(
		brainstorm
			? `plan draft ${name}: ${brainstorm.decisions.length} brainstorm decision(s) carried in`
			: `plan draft ${name}: no brainstorm decisions — drafting from the plan's own rows`,
	);

	return { merged, brainstorm };
};

interface AuthorParams {
	cwd: string;
	driver: Driver;
	name: string;
	workspaceDir: string;
	facts: Awaited<ReturnType<typeof readPlanFacts>>;
	decisions: DecisionsRecord;
	outputs: ReturnType<typeof planDraftOutputs>;
	standards?: string;
	model?: string;
	effort?: Effort;
	permissions?: Permissions;
	timeoutMs: number;
}

/**
 * The plan-writer spawn and everything that can end the draft with it: an agent
 * that failed or rate-limited, a facts/decisions discrepancy the agent found
 * (not a drafting bug — the inputs are wrong, so surface it and never loop), or
 * files it claimed but did not write.
 */
const authorPlanFiles = async ({
	cwd,
	driver,
	name,
	workspaceDir,
	facts,
	decisions,
	outputs,
	standards,
	model,
	effort,
	permissions,
	timeoutMs,
}: AuthorParams): Promise<{ stop: RunPlanDraftResult } | { planPaths: string[]; report: PlanDraftReport }> => {
	const lint = buildPlanLintCommand({ cwd, name });
	const invokePlanAgent = createPlanAgentRunner({ cwd, driver, workspaceDir, step: 'draft', model, effort, permissions, timeoutMs });
	const outcome = await invokePlanAgent({
		invocation: buildPlanWriterInvocation({ facts, decisions, outputs, standards, lintCommand: lint.command }),
		contract: PlanDraftReport,
		allowedCommands: [lint.prefix],
	});

	if (!outcome.ok) {
		return {
			stop: outcome.rateLimited
				? { status: PlanRunStatus.PausedRateLimit, workspaceDir, error: `rate limited or overloaded — re-run: lightsout plan draft --name ${name}` }
				: { status: PlanRunStatus.Failed, workspaceDir, error: outcome.failure },
		};
	}

	const { report } = outcome;

	if (report.status === PlanDraftStatus.Error) {
		return { stop: { status: PlanRunStatus.FactsError, workspaceDir, discrepancies: report.discrepancies } };
	}

	const drafted = await verifyDraftedFiles({ cwd, filesWritten: report.filesWritten });

	if ('error' in drafted) {
		return { stop: { status: PlanRunStatus.Failed, workspaceDir, error: drafted.error } };
	}

	return { planPaths: drafted.planPaths, report };
};

/**
 * Draft a structurally clean plan: a plan-writer agent authors the file(s) to
 * disk at the paths named in its prompt — once — then `repairPlanStructure`
 * lints the structure and converges any failures; survivors return as
 * `structural-issues` with the draft path intact. The engine owns the *path*
 * (told to the agent) and *verifies* the write; the agent owns the content. A
 * phased plan is a single spawn that authors `overview.md` plus every
 * `phase<N>-<slug>.md` into `.lightsout/plans/<name>/` — the same folder the
 * plan's workspace files live in (the agent chooses the breakdown; the engine
 * reads the paths back from the report and verifies each).
 * `plan draft` overwrites an existing deliverable — it is the from-scratch
 * authoring step, never re-run mid-convergence. Brainstorm's settled rows are
 * merged in at read time, so the plan's own `decisions.json` stays plan-owned.
 */
export const runPlanDraft = async ({
	cwd,
	driver,
	name,
	scope,
	standards,
	model,
	effort,
	permissions,
	timeoutMs = 30 * 60 * 1000,
	onProgress,
}: Params): Promise<RunPlanDraftResult> => {
	const progress = onProgress ?? (() => undefined);
	const workspaceDir = planWorkspaceDir({ cwd, name });

	await mkdir(workspaceDir, { recursive: true });

	const facts = await readPlanFacts({ cwd, name });
	const { merged, brainstorm } = await readMergedDecisions({ cwd, name, progress });
	const config = await readConfig({ cwd }).catch(() => undefined);
	const variant = scope ?? estimatePlanScope({ facts });

	progress(`plan draft ${name}: variant ${variant} (${scope ? 'scope flag' : 'estimated'})`);

	const authored = await authorPlanFiles({
		cwd,
		driver,
		name,
		workspaceDir,
		facts,
		decisions: merged,
		outputs: planDraftOutputs({ cwd, name, variant }),
		standards,
		model,
		effort,
		permissions,
		timeoutMs,
	});

	if ('stop' in authored) {
		return authored.stop;
	}

	const { planPaths, report } = authored;
	const repaired = await repairPlanStructure({
		cwd,
		driver,
		name,
		planPaths,
		workspaceDir,
		brainstormDecisionsPath: brainstorm ? join(workspaceDir, 'brainstorm-decisions.json') : undefined,
		config,
		model,
		effort,
		permissions,
		timeoutMs,
		progress,
	});

	if (repaired.status === PlanRunStatus.PausedRateLimit) {
		return { status: PlanRunStatus.PausedRateLimit, workspaceDir, error: repaired.error };
	}

	if (repaired.status === PlanRunStatus.Failed) {
		return { status: PlanRunStatus.Failed, workspaceDir, error: repaired.error };
	}

	if (repaired.findings.length > 0) {
		return { status: PlanRunStatus.StructuralIssues, workspaceDir, findings: repaired.findings, planPaths };
	}

	progress(`plan draft ${name}: structurally clean (${planPaths.length} file(s))`);

	return { status: PlanRunStatus.Complete, workspaceDir, planPaths, variant, report };
};
