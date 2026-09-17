import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readOptionalConfig } from '#src/common/config/readOptionalConfig.ts';
import { defaultExecutorFileLimit } from '#src/common/constants/defaultExecutorFileLimit.ts';
import { DraftImplementation, type Effort, type Permissions, PlanVariant } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';
import type { DraftContext } from '#src/plan/common/types/DraftContext.ts';
import type { RunPlanDraftResult } from '#src/plan/common/types/RunPlanDraftResult.ts';
import { readMergedDecisions } from '#src/plan/decisionLog/index.ts';
import { planWriterEnvironment } from '#src/plan/draft/common/constants/planWriterEnvironment.ts';
import { estimatePlanScope } from '#src/plan/draft/estimatePlanScope.ts';
import { draftFocusedPhasedPlan, draftFocusedSinglePlan } from '#src/plan/draft/focused/index.ts';
import { draftPhasedPlan, draftSinglePlan } from '#src/plan/draft/legacy/index.ts';
import { preflightDraftEnvironment } from '#src/plan/draft/preflightDraftEnvironment.ts';
import { collectSourceEvidence } from '#src/plan/evidence/index.ts';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';
import { readPlanFacts } from '#src/plan/readPlanFacts.ts';

interface Params {
	cwd: string;
	driver: Driver;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
	/** Force a variant; otherwise it is estimated from the facts' touched-file count. */
	scope?: PlanVariant;
	/** Which drafting implementation to use. Absent means focused, which is what makes focused the default without any caller opting in. */
	implementation?: DraftImplementation;
	/** Supplemental code standards, threaded into the plan-writer invocation. */
	standards?: string;
	model?: string;
	effort?: Effort;
	permissions?: Permissions;
	timeoutMs?: number;
	onProgress?: (message: string) => void;
}

/**
 * Draft a structurally clean plan. The engine owns the *path* (told to the
 * agent) and *verifies* the write; the agent owns the content.
 *
 * A single plan is one spawn writing `plan.md`, converged by
 * `repairPlanStructure`. A phased plan is drafted in **two stages**: one spawn
 * authors `overview.md` alone — including the machine-readable per-phase
 * declaration — and then one spawn per declared phase runs concurrently against
 * that declaration. The single all-files spawn this replaces was killed at its
 * thirty-minute ceiling mid-draft on a ten-phase plan; the declaration is what
 * makes the phase agents safe to run at once, because none of them has to read
 * another's unfinished text, and the deterministic cross-phase lint catches the
 * provenance and hand-off mismatches a parallel drafter could introduce.
 *
 * Between the two stages sits a deterministic door check on the declared phase
 * sizes, with a bounded reshape loop behind it: the cheapest moment to refuse an
 * unbuildable phase is before any phase file has been paid for.
 *
 * Two implementations author those spawns. **Focused** is the default and needs
 * no caller to ask for it: its writers run in a restricted agent environment and
 * are handed source evidence the engine collected once, rather than each
 * re-reading the same files. **Legacy** is the previous implementation, reached
 * only by typing `--legacy` on `lightsout plan draft`, and its behaviour is
 * unchanged. The engine never runs both, compares them, or falls back from one
 * to the other.
 *
 * A focused run is refused before any agent is spawned when the resolved harness
 * cannot provide a control the focused environment asks for. The refusal comes
 * back through the ordinary failed member, so every downstream reader keeps
 * working, and it runs before the evidence collection — collecting evidence walks
 * and reads the repository, and a run about to be refused should not pay for it.
 *
 * `plan draft` overwrites an existing deliverable — it is the from-scratch
 * authoring step, never re-run mid-convergence. Brainstorm's settled rows are
 * merged in at read time, so the plan's own `decisions.json` stays plan-owned.
 */
export const runPlanDraft = async ({
	cwd,
	driver,
	name,
	scope,
	implementation = DraftImplementation.Focused,
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
	const { merged, brainstorm } = await readMergedDecisions({ cwd, name, onProgress: progress });
	const config = await readOptionalConfig({ cwd });
	const executorFileLimit = config?.['executor-file-limit'] ?? defaultExecutorFileLimit;
	const variant = scope ?? estimatePlanScope({ facts, executorFileLimit });
	const focused = implementation === DraftImplementation.Focused;
	// Legacy skips the preflight entirely, which is what makes `--legacy` a usable
	// escape on a harness that cannot provide the focused environment.
	const refusal = focused ? preflightDraftEnvironment({ driver, environment: planWriterEnvironment }) : undefined;

	if (refusal !== undefined) {
		return { status: PlanRunStatus.Failed, workspaceDir, error: refusal, advisories: [], implementation };
	}

	progress(`plan draft ${name}: variant ${variant} (${scope ? 'scope flag' : 'estimated'})`);

	const context: DraftContext = {
		cwd,
		driver,
		name,
		workspaceDir,
		facts,
		decisions: merged,
		brainstormDecisionsPath: brainstorm ? join(workspaceDir, 'brainstorm-decisions.json') : undefined,
		implementation,
		evidence: focused ? await collectSourceEvidence({ cwd, name, facts, config }) : undefined,
		config,
		executorFileLimit,
		standards,
		model,
		effort,
		permissions,
		timeoutMs,
		progress,
	};

	if (focused) {
		return variant === PlanVariant.Single ? draftFocusedSinglePlan({ context }) : draftFocusedPhasedPlan({ context, step: 'draft' });
	}

	return variant === PlanVariant.Single ? draftSinglePlan({ context }) : draftPhasedPlan({ context, step: 'draft' });
};
