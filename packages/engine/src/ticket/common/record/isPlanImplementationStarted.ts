import { PlanProgress, type TicketPlan } from '#src/contracts/index.ts';

interface Params {
	plan: TicketPlan;
}

/**
 * Whether an implementation run has ever been started for this plan.
 *
 * Progress decides it rather than the `implementation` block: a plan made out of
 * a source folder that was already built carries no block, because a run
 * manifest records no start commit, and it is still a plan whose implementation
 * started.
 */
export const isPlanImplementationStarted = ({ plan }: Params): boolean =>
	plan.progress === PlanProgress.Implementing || plan.progress === PlanProgress.Implemented || plan.progress === PlanProgress.Failed;
