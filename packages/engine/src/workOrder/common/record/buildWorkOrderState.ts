import { type LightsoutConfig, WorkOrderMode, type WorkOrderState } from '#src/contracts/index.ts';
import { readTicketMatch, resolveShipSettings } from '#src/ship/index.ts';

interface Params {
	/** The work order's label, which is also the branch its plans implement on. */
	name: string;
	config: LightsoutConfig;
}

/**
 * A work order's state as it is born: the ticket its folder name carries, that
 * branch, the repository's default mode, and nothing else.
 *
 * The ticket id is read with the repo's own `ship.ticket-pattern` through
 * `readTicketMatch`, so a plan folder and a branch never disagree about which
 * ticket they belong to. The mode is seeded from `plan.default-work-order-mode`
 * here and only here: from this moment it is the work order's own saved choice, and
 * changing the repository default never rewrites it.
 *
 * The one home of the shape a work order state is born in, including where the
 * mode is seeded from and that it is seeded only once. `work-order add-plan` is the
 * only caller left now that it creates every record, and this stays its own file
 * because a record's birth is worth looking up by name rather than reading out
 * of the middle of a plan being added.
 */
export const buildWorkOrderState = ({ name, config }: Params): WorkOrderState | { error: string } => {
	const shipSettings = resolveShipSettings({ config });

	if (shipSettings === undefined) {
		return {
			error: `ship.ticket-pattern is not a regular expression capturing a 'ticket' group, so no ticket id can be read out of the folder name '${name}' — fix the key in lightsout.config.json`,
		};
	}

	const ticketRef = readTicketMatch({ branch: name, ticketPattern: shipSettings.ticketPattern })?.ticket;

	if (ticketRef === undefined) {
		return {
			error: `the plan folder '${name}' carries no ticket id matching this repo's ship.ticket-pattern, and a work order state names the one ticket it belongs to — name the folder after the ticket's branch`,
		};
	}

	return {
		schemaVersion: 1,
		ticketRef,
		branch: name,
		mode: config.plan?.['default-work-order-mode'] ?? WorkOrderMode.SinglePlan,
		plans: [],
		history: [],
	};
};
