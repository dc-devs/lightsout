import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ActivityLevel } from '#src/activity/common/types/ActivityLevel.ts';
import { readOptionalConfig } from '#src/common/config/readOptionalConfig.ts';
import { defaultExecutorFileLimit } from '#src/common/constants/defaultExecutorFileLimit.ts';
import type { Effort } from '#src/contracts/Effort.ts';
import type { Permissions } from '#src/contracts/Permissions.ts';
import { DraftImplementation } from '#src/contracts/plan/draft/DraftImplementation.ts';
import { PlanVariant } from '#src/contracts/plan/draft/PlanVariant.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';
import { readMergedDecisions } from '#src/plan/decisionLog/readMergedDecisions.ts';
import { estimatePlanScope } from '#src/plan/draft/estimatePlanScope.ts';
import { draftFocusedPhasedPlan } from '#src/plan/draft/focused/draftFocusedPhasedPlan.ts';
import { draftFocusedSinglePlan } from '#src/plan/draft/focused/draftFocusedSinglePlan.ts';
import { planWriterEnvironment } from '#src/plan/draft/internal/common/constants/planWriterEnvironment.ts';
import { preflightDraftEnvironment } from '#src/plan/draft/internal/preflightDraftEnvironment.ts';
import { draftPhasedPlan } from '#src/plan/draft/legacy/draftPhasedPlan.ts';
import { draftSinglePlan } from '#src/plan/draft/legacy/draftSinglePlan.ts';
import { collectSourceEvidence } from '#src/plan/evidence/collectSourceEvidence.ts';
import type { DraftContext } from '#src/plan/internal/common/types/DraftContext.ts';
import type { RunPlanDraftResult } from '#src/plan/internal/common/types/RunPlanDraftResult.ts';
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
	/** The command-run level this draft's spawns attach to. Absent wherever no run is being recorded. */
	level?: ActivityLevel;
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
 * The preflight refusal below returns before the context is built and so opens
 * no level at all — the refuse-before-any-work rule applied to the one refusal
 * this runner has.
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
	level,
	onProgress,
}: Params): Promise<RunPlanDraftResult> => {
	const progress = onProgress ?? (() => undefined);
	const workspaceDir = await planWorkspaceDir({ cwd, name });

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
		level,
		progress,
	};

	if (focused) {
		return variant === PlanVariant.Single ? draftFocusedSinglePlan({ context }) : draftFocusedPhasedPlan({ context, step: 'draft' });
	}

	return variant === PlanVariant.Single ? draftSinglePlan({ context }) : draftPhasedPlan({ context, step: 'draft' });
};
