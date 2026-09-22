import type { PipelineResult } from '#src/pipeline/index.ts';

/** What a wrapped pipeline run left behind — see {@link runWorkOrderPlanLifecycle}. */
export type WorkOrderPlanOutcome =
	| { refusal: string }
	| {
			result: PipelineResult;
			/** A record write that did not take. The run happened regardless, so its result still stands. */
			recordError?: string;
			/** The one sentence a pass that covered only part of the plan owes its reader. */
			note?: string;
	  };
