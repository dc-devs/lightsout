import type { ShipRequestTerms } from '#src/ship/index.ts';

/** What a work order state says about one run of one of its plans — see {@link readWorkOrderRunTerms}. */
export interface WorkOrderRunTerms {
	/** The one sentence saying why this plan may not be built yet, or undefined when it may. */
	refusal?: string;
	/** The ticket's own say over this run's shipping. Absent where `--ship` and `ship.after-implement` decide it, as they always have. */
	shipRequest?: ShipRequestTerms;
}
