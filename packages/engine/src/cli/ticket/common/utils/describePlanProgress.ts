import { PlanProgress } from '#src/contracts/index.ts';

interface Params {
	progress: PlanProgress;
}

/** What each progress value reads as, keeping ready to implement and implemented plainly apart. */
const planProgressWording: Record<PlanProgress, string> = {
	[PlanProgress.Planning]: 'being planned',
	[PlanProgress.Ready]: 'ready to implement',
	[PlanProgress.Implementing]: 'its implementation has not finished',
	[PlanProgress.Implemented]: 'implemented',
	[PlanProgress.Failed]: 'its implementation failed',
};

/**
 * How far one plan has got, in words a human reads rather than the value the
 * record stores.
 *
 * Shared by every `lightsout ticket` line that shows a plan, so a plan that is
 * only ready to implement never reads as one that is implemented, and a plan
 * whose implementation has not finished is never called unfinished.
 */
export const describePlanProgress = ({ progress }: Params): string => planProgressWording[progress];
