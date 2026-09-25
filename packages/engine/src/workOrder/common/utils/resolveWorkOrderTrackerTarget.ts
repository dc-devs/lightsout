import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { resolveTrackerSettings } from '#src/ticketTracker/resolveTrackerSettings.ts';
import type { TicketTrackerTarget } from '#src/workOrder/common/types/TicketTrackerTarget.ts';

interface Params {
	config: LightsoutConfig;
	/** The process environment the tracker API key is read from. Passed rather than read, so a test never mutates `process.env`. */
	env: NodeJS.ProcessEnv;
	/** The work order's label, named in every sentence this answers. */
	workOrderName: string;
	/** The ticket reference the work order's record carries, or undefined for a work order that belongs to no ticket. */
	ticketRef: string | undefined;
}

/**
 * Where a work order's state publishes to: the resolved tracker and the ticket
 * its record names, or why this work order is local only, or why a configured
 * tracker cannot be used.
 *
 * The three answers are deliberately different things. `localOnly` means there
 * is nothing to publish to and never was — no `ticket-tracker` block, or a
 * record carrying no ticket reference — and a local record is then the whole
 * truth. `error` means a tracker IS configured and could not be reached, which
 * must never be passed over: skipping it would let a published record move
 * without this machine ever noticing.
 *
 * The reference is taken rather than derived. Which ticket a work order belongs
 * to is the record's own answer, so nothing here reads a folder name or a
 * branch pattern to rebuild one.
 */
export const resolveWorkOrderTrackerTarget = ({
	config,
	env,
	workOrderName,
	ticketRef,
}: Params): TicketTrackerTarget | { localOnly: string } | { error: string } => {
	if (config['ticket-tracker'] === undefined) {
		return {
			localOnly: `the work order state for '${workOrderName}' is local only: lightsout.config.json has no \`ticket-tracker\` block naming a provider and its credentials`,
		};
	}

	if (ticketRef === undefined) {
		return { localOnly: `the work order state for '${workOrderName}' is local only: its record carries no ticket reference, so it belongs to no ticket` };
	}

	const settings = resolveTrackerSettings({ config, env });

	return 'error' in settings ? settings : { settings, ticketRef };
};
