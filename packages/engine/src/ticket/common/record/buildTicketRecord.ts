import { type LightsoutConfig, TicketMode, type TicketRecord } from '#src/contracts/index.ts';
import { readTicketMatch, resolveShipSettings } from '#src/ship/index.ts';

interface Params {
	/** The ticket folder's name, which is also the branch its plans implement on. */
	ticketBranch: string;
	config: LightsoutConfig;
}

/**
 * A ticket's record as it is born: the ticket its folder name carries, that
 * branch, the repository's default mode, and nothing else.
 *
 * The ticket id is read with the repo's own `ship.ticket-pattern` through
 * `readTicketMatch`, so a plan folder and a branch never disagree about which
 * ticket they belong to. The mode is seeded from `plan.default-ticket-mode`
 * here and only here: from this moment it is the ticket's own saved choice, and
 * changing the repository default never rewrites it.
 *
 * Shared by the only two places a record is born — `ticket add-plan` and
 * `ticket adopt` — because a record created two ways could be created two
 * different shapes.
 */
export const buildTicketRecord = ({ ticketBranch, config }: Params): TicketRecord | { error: string } => {
	const shipSettings = resolveShipSettings({ config });

	if (shipSettings === undefined) {
		return {
			error: `ship.ticket-pattern is not a regular expression capturing a 'ticket' group, so no ticket id can be read out of the folder name '${ticketBranch}' — fix the key in lightsout.config.json`,
		};
	}

	const ticketRef = readTicketMatch({ branch: ticketBranch, ticketPattern: shipSettings.ticketPattern })?.ticket;

	if (ticketRef === undefined) {
		return {
			error: `the plan folder '${ticketBranch}' carries no ticket id matching this repo's ship.ticket-pattern, and a ticket record is one ticket's record — name the folder after the ticket's branch`,
		};
	}

	return { schemaVersion: 1, ticketRef, branch: ticketBranch, mode: config.plan?.['default-ticket-mode'] ?? TicketMode.SinglePlan, plans: [], history: [] };
};
