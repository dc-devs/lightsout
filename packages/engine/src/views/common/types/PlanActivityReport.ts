import type { ActivityReport } from '#src/contracts/index.ts';

/**
 * One plan's place in a report.
 *
 * A named type rather than an inline shape because three callers name it: the
 * reader that builds it, the printer that draws it and the command that
 * serialises it.
 */
export interface PlanActivityReport {
	/** The plan this covers — a plan address, or a legacy plan folder's name. */
	name: string;
	/** The totalled tree, or undefined when that plan folder holds no activity record. */
	report: ActivityReport | undefined;
}
