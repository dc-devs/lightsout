import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { formatPlanAddress } from '#src/common/planAddress/formatPlanAddress.ts';
import { planNumberOf } from '#src/common/planAddress/planNumberOf.ts';
import { isGeneratedPath } from '#src/common/sourceFiles/isGeneratedPath.ts';
import { type LightsoutConfig, PlanProgress, WorkOrderMode, type WorkOrderState } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { pathExists, planWorkspaceDir } from '#src/plan/index.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import type { WorkerOutcome } from '#src/queue/common/types/WorkerOutcome.ts';
import type { TicketPlanStep } from '#src/queue/workers/common/types/TicketPlanStep.ts';
import { buildFromTicketBody } from '#src/queue/workers/common/utils/buildFromTicketBody.ts';
import { findStalledPlanRefusal } from '#src/queue/workers/common/utils/findStalledPlanRefusal.ts';
import { settleLeftoverWork } from '#src/queue/workers/common/utils/settleLeftoverWork.ts';
import { runPlanFolderPipeline } from '#src/queue/workers/runPlanFolderPipeline.ts';
import { readTicketRecord, readTicketShipEligibility, restoreTicketPlan } from '#src/ticket/index.ts';

interface Params {
	/** The ticket's worktree: where each plan is restored, built and committed. */
	cwd: string;
	/** The ticket's branch — the ticket-folder segment of every plan address. */
	branch: string;
	ticket: TicketSummary;
	/** The record as the caller's pull answered it. */
	record: WorkOrderState;
	config: LightsoutConfig;
	/** The process environment the tracker credentials are read from. */
	env: NodeJS.ProcessEnv;
	driver: Driver;
	/** Recorded as the harness name on a build from the ticket body. */
	driverName: string;
	/** The ticket's directory under the coordinator run, where each plan's commit message file is written. */
	ticketRunDir: string;
	/** True only for the plan worker: a single-plan ticket whose plan 001 is still being planned is then built from the ticket body. */
	allowTicketBodyBuild: boolean;
	onProgress?: (message: string) => void;
}

/**
 * The source work already in the worktree when the loop starts, read once.
 *
 * Generated paths are left out: build output is the pre-ship step's to commit,
 * never a plan's.
 */
const readLeftoverWork = async ({ cwd, config }: { cwd: string; config: LightsoutConfig }) => {
	const changed = (await readGitChangedFiles({ cwd })) ?? [];

	return changed.filter((path) => !isGeneratedPath({ path, generated: config.generated ?? [] }));
};

/**
 * The plan the loop takes next: the lowest-numbered plan nothing has excluded
 * whose implementation has not finished.
 *
 * The contract keeps `plans` in number order, so array order is numeric order —
 * nothing sorts, and nothing skips past a plan that is not ready to implement.
 */
const findNextPlanToBuild = ({ record }: { record: WorkOrderState }) =>
	record.plans.find((plan) => plan.exclusion === undefined && plan.progress !== PlanProgress.Implemented);

/** A plan nobody has finished planning: a multiple-plan ticket waits for it, and a single-plan ticket falls back to the ticket body or stops. */
const takePlanBeingPlanned = ({ step, allowTicketBodyBuild }: { step: TicketPlanStep; allowTicketBodyBuild: boolean }) => {
	const { record, plan } = step;

	if (record.mode !== WorkOrderMode.SinglePlan) {
		return { open: `plan ${plan.id} on ticket ${record.branch} is still being planned, so the ticket stays open until that plan is ready to implement` };
	}

	if (!allowTicketBodyBuild || planNumberOf({ id: plan.id }) !== 1) {
		return {
			error: `plan ${plan.id} on ticket ${record.branch} is still being planned, so the ticket has nothing ready to implement — plan it with \`lightsout plan --name ${formatPlanAddress({ ticketBranch: record.branch, planId: plan.id })}\``,
		};
	}

	return buildFromTicketBody({ step });
};

/** A plan that is ready to implement, fetched back from the ticket when this worktree holds no copy of it, then built. */
const buildReadyPlan = async ({ step }: { step: TicketPlanStep }) => {
	const { cwd, record, plan, config, env, driver, onProgress } = step;
	const address = formatPlanAddress({ ticketBranch: record.branch, planId: plan.id });

	if (!(await pathExists({ path: await planWorkspaceDir({ cwd, name: address }) }))) {
		const restored = await restoreTicketPlan({ cwd, address, config, env, onProgress });

		if ('error' in restored) {
			return { error: restored.error };
		}

		if (restored.restored.length === 0) {
			return { error: `plan ${plan.id} is ready to implement on ticket ${record.branch}, but ${record.ticketRef} carries no published files for it` };
		}
	}

	return runPlanFolderPipeline({ cwd, name: address, config, driver, onProgress });
};

/**
 * The record read again to see what the lifecycle helper wrote on the plan.
 *
 * The build's own pipeline committed the work it made, one commit per unit that
 * passed its own gates, so nothing is committed here. The re-read is what keeps
 * the loop honest: a pass the record does not show as an implementation that
 * finished — a run over one phase file of the plan, say — would otherwise make
 * the next turn take the same plan again.
 */
const confirmPlanImplemented = async ({ step, branch }: { step: TicketPlanStep; branch: string }) => {
	const { cwd, plan } = step;
	const reread = await readTicketRecord({ cwd, ticketBranch: branch });

	if ('error' in reread) {
		return reread;
	}

	const { record } = reread;

	if (record?.plans.find((candidate) => candidate.id === plan.id)?.progress !== PlanProgress.Implemented) {
		return {
			error: `plan ${plan.id} on ticket ${branch} was built and passed, but its implementation is not recorded as finished, so the queue stopped rather than build it again`,
		};
	}

	return { record };
};

/** What the record says about the ticket once there is nothing left to build: ship it, leave it open, or park it. */
const decideTicketOutcome = ({ record }: { record: WorkOrderState }) => {
	const eligibility = readTicketShipEligibility({ record });

	if (eligibility.eligible) {
		return {};
	}

	// A single-plan ticket is never left open: plan 001 alone supplies its
	// implementation, so anything short of that is a human's to look at.
	return record.mode === WorkOrderMode.MultiplePlan ? { open: eligibility.reason } : { error: eligibility.reason };
};

/**
 * Build the plans of one ticket that are ready to implement, one at a time and
 * lowest number first. Each plan's own pipeline commits the implementation it
 * built before the next plan starts, so a later plan is always built on the
 * commit the plans before it left.
 *
 * The order is the point: the plans share one branch. A lower plan still being
 * planned leaves the ticket open, and a lower plan whose implementation has not
 * finished parks it naming that plan — the queue repairs neither itself.
 *
 * Every plan-folder build goes through `runPlanFolderPipeline`, which wraps the
 * run in the ticket lifecycle helper: the order refusals, the refusal of a plan
 * republished from another machine, and the progress every later plan and every
 * ship reads are written there rather than here. This loop writes nothing to the
 * record itself, and neither pushes nor fetches.
 *
 * @returns success once nothing is left to build and the ticket may ship, the reason it stays open, or the reason it parks
 */
export const buildTicketPlans = async ({
	cwd,
	branch,
	ticket,
	record,
	config,
	env,
	driver,
	driverName,
	ticketRunDir,
	allowTicketBodyBuild,
	onProgress,
}: Params): Promise<WorkerOutcome> => {
	// Read once, before anything is built, so what it reports is unambiguously
	// work that was already there rather than work this loop made.
	const leftover = await readLeftoverWork({ cwd, config });
	let current = record;
	let settled = false;

	for (;;) {
		const plan = findNextPlanToBuild({ record: current });

		if (plan === undefined) {
			return decideTicketOutcome({ record: current });
		}

		const step: TicketPlanStep = { cwd, record: current, plan, ticket, config, env, driver, driverName, ticketRunDir, onProgress };
		// Asked before any leftover work is settled: a failed or paused build's
		// partial changes are what `lightsout resume` expects to find in the tree,
		// so committing them under another plan's message would take them out of it.
		const stalled = findStalledPlanRefusal({ record: current, plan });

		if (stalled !== undefined) {
			return { error: stalled };
		}

		if (!settled) {
			const unsettled = await settleLeftoverWork({ step, leftover });

			if (unsettled !== undefined) {
				return { error: unsettled };
			}

			settled = true;
		}

		const built = plan.progress === PlanProgress.Planning ? await takePlanBeingPlanned({ step, allowTicketBodyBuild }) : await buildReadyPlan({ step });

		if (built.error !== undefined || built.open !== undefined) {
			return built;
		}

		const confirmed = await confirmPlanImplemented({ step, branch });

		if ('error' in confirmed) {
			return { error: confirmed.error };
		}

		current = confirmed.record;
	}
};
