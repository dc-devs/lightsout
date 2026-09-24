import { type LightsoutConfig, WorkOrderMode, type WorkOrderState } from '#src/contracts/index.ts';

interface Params {
	/** The work order's label — its folder's name under the work-orders directory. */
	name: string;
	/** The git branch its plans implement on. */
	branch: string;
	/** The ticket this work belongs to, when one was named. Absent for a work order named from words alone. */
	ticketRef?: string;
	/** The mode this record is born in when the caller has settled it; absent, the repository default. */
	mode?: WorkOrderMode;
	config: LightsoutConfig;
}

/**
 * A work order's state as it is born: its label, the branch its plans implement
 * on, the ticket it belongs to when one was named, the repository's default
 * mode, and nothing else.
 *
 * It derives nothing — every name is handed to it, because one writer of a name
 * is the whole point. The mode is seeded from `plan.default-work-order-mode`
 * here and only here: from this moment it is the work order's own saved choice,
 * and changing the repository default never rewrites it. A caller may hand the
 * mode instead of the default — the queue does, for a ticket it builds from the
 * ticket body.
 *
 * The one home of the shape a work order state is born in, including where the
 * mode is seeded from and that it is seeded only once. This stays its own file
 * because a record's birth is worth looking up by name rather than reading out
 * of the middle of a plan being added.
 */
export const buildWorkOrderState = ({ name, branch, ticketRef, mode, config }: Params): WorkOrderState => ({
	schemaVersion: 1,
	name,
	branch,
	...(ticketRef === undefined ? {} : { ticketRef }),
	mode: mode ?? config.plan?.['default-work-order-mode'] ?? WorkOrderMode.SinglePlan,
	plans: [],
	history: [],
});
