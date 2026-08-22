import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readConfig } from '#src/common/config/readConfig.ts';
import { defaultExecutorFileLimit } from '#src/common/constants/defaultExecutorFileLimit.ts';
import { type DecisionsRecord, type Effort, type Permissions, PlanVariant } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { DraftContext } from '#src/plan/common/types/DraftContext.ts';
import type { RunPlanDraftResult } from '#src/plan/common/types/RunPlanDraftResult.ts';
import { draftPhasedPlan } from '#src/plan/draft/draftPhasedPlan.ts';
import { draftSinglePlan } from '#src/plan/draft/draftSinglePlan.ts';
import { estimatePlanScope } from '#src/plan/draft/estimatePlanScope.ts';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';
import { readBrainstormDecisions } from '#src/plan/readBrainstormDecisions.ts';
import { readDecisions } from '#src/plan/readDecisions.ts';
import { readPlanFacts } from '#src/plan/readPlanFacts.ts';

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
	const executorFileLimit = config?.['executor-file-limit'] ?? defaultExecutorFileLimit;
	const variant = scope ?? estimatePlanScope({ facts, executorFileLimit });

	progress(`plan draft ${name}: variant ${variant} (${scope ? 'scope flag' : 'estimated'})`);

	const context: DraftContext = {
		cwd,
		driver,
		name,
		workspaceDir,
		facts,
		decisions: merged,
		brainstormDecisionsPath: brainstorm ? join(workspaceDir, 'brainstorm-decisions.json') : undefined,
		config,
		executorFileLimit,
		standards,
		model,
		effort,
		permissions,
		timeoutMs,
		progress,
	};

	return variant === PlanVariant.Single ? draftSinglePlan({ context }) : draftPhasedPlan({ context, step: 'draft' });
};
