import { mkdir } from 'node:fs/promises';
import { PlanDraftReport, PlanDraftStatus, type Effort, type Permissions, type PlanVariant, type StructuralFinding } from '@/contracts';
import { buildPlanWriterInvocation } from '@/agents';
import type { Driver } from '@/drivers';
import { createPlanAgentRunner } from '@/plan/common/utils/createPlanAgentRunner';
import { estimatePlanScope } from '@/plan/estimatePlanScope';
import { loadConfig } from '@/common/utils/loadConfig';
import { planDraftOutputs } from '@/plan/common/paths/planDraftOutputs';
import { buildPlanLintCommand } from '@/plan/common/utils/buildPlanLintCommand';
import { planWorkspaceDir } from '@/plan/planWorkspaceDir';
import { verifyDraftedFiles } from '@/plan/common/paths/verifyDraftedFiles';
import { readDecisions } from '@/plan/readDecisions';
import { readPlanFacts } from '@/plan/readPlanFacts';
import { repairPlanStructure } from '@/plan/repairPlanStructure';

const defaultDraftTimeoutMs = 30 * 60 * 1000;

interface Params {
	cwd: string;
	driver: Driver;
	/** Kebab plan name — the workspace key and the deliverable's basename. */
	name: string;
	/** Resolved absolute directory where committed plan deliverables live. */
	plansDir: string;
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
	| { status: 'complete'; workspaceDir: string; planPaths: string[]; variant: PlanVariant; report: PlanDraftReport }
	| { status: 'failed'; workspaceDir: string; error: string }
	| { status: 'paused-rate-limit'; workspaceDir: string; error: string }
	| { status: 'facts-error'; workspaceDir: string; discrepancies: string[] }
	| { status: 'structural-issues'; workspaceDir: string; findings: StructuralFinding[]; planPaths: string[] };

/**
 * Draft a structurally clean plan: a plan-writer agent authors the file(s) to
 * disk at the paths named in its prompt — once — then `repairPlanStructure`
 * lints the structure and converges any failures; survivors return as
 * `structural-issues` with the draft path intact. The engine owns the *path*
 * (told to the agent) and *verifies* the write; the agent owns the content. A
 * phased plan is a single spawn that authors `overview.md` plus every
 * `phase<N>-<slug>.md` into `<plansDir>/<name>/` (the agent chooses the
 * breakdown; the engine reads the paths back from the report and verifies each).
 * `plan draft` overwrites an existing deliverable — it is the from-scratch
 * authoring step, never re-run mid-convergence.
 */
export const runPlanDraft = async ({
	cwd,
	driver,
	name,
	plansDir,
	scope,
	standards,
	model,
	effort,
	permissions,
	timeoutMs = defaultDraftTimeoutMs,
	onProgress,
}: Params): Promise<RunPlanDraftResult> => {
	const progress = onProgress ?? (() => undefined);
	const workspaceDir = planWorkspaceDir({ cwd, name });

	await mkdir(workspaceDir, { recursive: true });

	const facts = await readPlanFacts({ cwd, name });
	const decisions = await readDecisions({ cwd, name });
	const config = await loadConfig({ cwd }).catch(() => undefined);
	const variant = scope ?? estimatePlanScope({ facts });

	const { outputs, dir } = planDraftOutputs({ plansDir, name, variant });

	await mkdir(dir, { recursive: true });

	progress(`plan draft ${name}: variant ${variant} (${scope ? 'scope flag' : 'estimated'})`);

	const lint = buildPlanLintCommand({ cwd, name, plansDir });
	const invokePlanAgent = createPlanAgentRunner({ cwd, driver, workspaceDir, step: 'draft', model, effort, permissions, timeoutMs });
	const outcome = await invokePlanAgent({
		invocation: buildPlanWriterInvocation({ facts, decisions, outputs, standards, lintCommand: lint.command }),
		contract: PlanDraftReport,
		allowedCommands: [lint.prefix],
	});

	if (!outcome.ok) {
		return outcome.rateLimited
			? { status: 'paused-rate-limit' as const, workspaceDir, error: `rate limit reached — re-run: lightsout plan draft --name ${name}` }
			: { status: 'failed' as const, workspaceDir, error: outcome.failure };
	}

	const { report } = outcome;

	// A facts/decisions discrepancy the agent found is not a drafting bug — the
	// inputs are wrong. Surface it for the session to re-explore; never loop.
	if (report.status === PlanDraftStatus.Error) {
		return { status: 'facts-error' as const, workspaceDir, discrepancies: report.discrepancies };
	}

	const drafted = await verifyDraftedFiles({ cwd, filesWritten: report.filesWritten });

	if ('error' in drafted) {
		return { status: 'failed' as const, workspaceDir, error: drafted.error };
	}

	const { planPaths } = drafted;
	const repaired = await repairPlanStructure({ cwd, driver, name, planPaths, workspaceDir, config, model, effort, permissions, timeoutMs, progress });

	if (repaired.status === 'paused-rate-limit') {
		return { status: 'paused-rate-limit' as const, workspaceDir, error: repaired.error };
	}

	if (repaired.status === 'failed') {
		return { status: 'failed' as const, workspaceDir, error: repaired.error };
	}

	if (repaired.findings.length > 0) {
		return { status: 'structural-issues' as const, workspaceDir, findings: repaired.findings, planPaths };
	}

	progress(`plan draft ${name}: structurally clean (${planPaths.length} file(s))`);

	return { status: 'complete' as const, workspaceDir, planPaths, variant, report };
};
