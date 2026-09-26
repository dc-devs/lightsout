import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { getTicketsByIdentifiers } from '#src/ticketTracker/getTicketsByIdentifiers.ts';
import { resolveTrackerSettings } from '#src/ticketTracker/resolveTrackerSettings.ts';

interface Params {
	/** The ticket reference the caller typed, in whatever case they typed it. */
	ticketRef: string;
	config: LightsoutConfig;
	/** The process environment the tracker API key is read from. */
	env: NodeJS.ProcessEnv;
}

/**
 * One ticket's title, read from the tracker, with the reference spelled the way
 * the tracker itself spells it.
 *
 * Both halves come back because both are needed: the title is what gets
 * summarised into a label, and the identifier is what the record stores, so a
 * caller who typed `lo-158` files the work order under the tracker's own
 * `LO-158`. That value exists nowhere else on this side of the call.
 *
 * It keeps 'ticket' in its name deliberately — it names a thing in Linear or
 * Jira, which is the only thing that word still means.
 *
 * A refusal is never turned into a guessed title by anything downstream: a
 * guess would be a second author of the name, which is what one writer of a
 * name exists to prevent. The sentence therefore names both what is missing and
 * `--title`, which names the work without a tracker at all.
 */
export const readTicketTitle = async ({ ticketRef, config, env }: Params): Promise<{ ticketRef: string; title: string } | { error: string }> => {
	const settings = resolveTrackerSettings({ config, env });

	if ('error' in settings) {
		return { error: `${settings.error} — or name this work yourself with \`--title <words>\`, which needs no tracker at all` };
	}

	const tickets = await getTicketsByIdentifiers({ settings, identifiers: [ticketRef] });

	if ('error' in tickets) {
		return { error: `the tracker could not be asked about ${ticketRef}: ${tickets.error}` };
	}

	const ticket = tickets[0];

	return ticket === undefined
		? { error: `the tracker holds no ticket ${ticketRef} — check the reference, or name this work yourself with \`--title <words>\`` }
		: { ticketRef: ticket.identifier, title: ticket.title };
};
