import type { LightsoutConfig } from '#src/contracts/index.ts';
import { readPlanTicketRef } from '#src/plan/index.ts';
import { resolveShipSettings } from '#src/ship/index.ts';
import { resolveTrackerSettings } from '#src/ticketTracker/index.ts';
import type { TicketTrackerTarget } from '#src/workOrder/common/types/TicketTrackerTarget.ts';

interface Params {
	config: LightsoutConfig;
	/** The process environment the tracker API key is read from. Passed rather than read, so a test never mutates `process.env`. */
	env: NodeJS.ProcessEnv;
	/** The work order's label, which is also the branch its plans implement on. */
	name: string;
}

/**
 * Where a work order's state publishes to: the resolved tracker and the ticket the
 * folder's name carries, or why this ticket is local only, or why a configured
 * tracker cannot be used.
 *
 * The three answers are deliberately different things. `localOnly` means there
 * is nothing to publish to and never was — no `ticket-tracker` block, an
 * unusable `ship.ticket-pattern`, or a folder name carrying no ticket id — and
 * a local record is then the whole truth. `error` means a tracker IS configured
 * and could not be reached, which must never be passed over: skipping it would
 * let a published record move without this machine ever noticing.
 */
export const resolveWorkOrderTrackerTarget = ({ config, env, name }: Params): TicketTrackerTarget | { localOnly: string } | { error: string } => {
	if (config['ticket-tracker'] === undefined) {
		return {
			localOnly: `the work order state for '${name}' is local only: lightsout.config.json has no \`ticket-tracker\` block naming a provider and its credentials`,
		};
	}

	const shipSettings = resolveShipSettings({ config });

	if (shipSettings === undefined) {
		return {
			localOnly: `the work order state for '${name}' is local only: ship.ticket-pattern is not a regular expression capturing a 'ticket' group, so no ticket id can be read out of the folder name`,
		};
	}

	const ticketRef = readPlanTicketRef({ name: name, ticketPattern: shipSettings.ticketPattern });

	if (ticketRef === undefined) {
		return {
			localOnly: `the work order state for '${name}' is local only: that folder name carries no ticket id matching this repo's ship.ticket-pattern`,
		};
	}

	const settings = resolveTrackerSettings({ config, env });

	return 'error' in settings ? settings : { settings, ticketRef };
};
