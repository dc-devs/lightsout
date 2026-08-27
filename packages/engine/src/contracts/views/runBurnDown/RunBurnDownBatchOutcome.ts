/**
 * How one work-list batch ended, as a burn-down reads it.
 *
 * The first two are the batch report's own verdict. `NotRun` is this reader's
 * own: a batch the run never reached, or one whose recorded report will not
 * parse, left its sites exactly where the work-list froze them.
 */
export const RunBurnDownBatchOutcome = {
	Resolved: 'resolved',
	Declined: 'declined',
	NotRun: 'not-run',
} as const;

export type RunBurnDownBatchOutcome = (typeof RunBurnDownBatchOutcome)[keyof typeof RunBurnDownBatchOutcome];
