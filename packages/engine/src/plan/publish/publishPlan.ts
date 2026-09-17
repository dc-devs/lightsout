import { sha256 } from '#src/common/utils/sha256.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { attachDurableFiles } from '#src/plan/publish/common/utils/attachDurableFiles.ts';
import { prepareAttachments } from '#src/plan/publish/common/utils/prepareAttachments.ts';
import { reportStaleAttachments } from '#src/plan/publish/common/utils/reportStaleAttachments.ts';
import { durablePlanFiles } from '#src/plan/publish/durablePlanFiles.ts';
import { readPlanTicketRef } from '#src/plan/readPlanTicketRef.ts';
import { resolveShipSettings } from '#src/ship/index.ts';
import { getTicketsByIdentifiers, resolveTrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
	config: LightsoutConfig;
	/** The process environment the tracker API key is read from. Passed rather than read, so a test never mutates `process.env`. */
	env: NodeJS.ProcessEnv;
	onProgress: (message: string) => void;
	/** The plan id every attachment title is namespaced under; absent for a legacy folder, whose titles stay bare. */
	titlePrefix?: string;
}

interface PublishReport {
	/** The ticket the files landed on, e.g. 'LO-54'. Absent when nothing was published. */
	ticketRef?: string;
	/** Each published attachment's own name, ending with the generation commit marker. */
	published: string[];
	/** Durable-titled attachments outside the committed generation. Reported, never deleted. */
	stale: string[];
	/** Set when the publish stopped — the one sentence saying why. */
	error?: string;
	/**
	 * SHA-256 of the commit marker's bytes, set only for a prefixed publish in
	 * which every attachment including the marker landed. A legacy folder has no
	 * ticket record to record a generation in, so nothing asks for it there.
	 */
	markerSha256?: string;
}

/**
 * Put a plan folder's durable set on the ticket the folder is named after,
 * committing the exact names and hashes with a manifest attached last.
 *
 * The refusals are ordered disk first, then the folder's own name, then
 * configuration, then the network: the first two are answered with no config
 * and no round trip, and "this folder holds no plan" is the failure a user hits
 * most. The queue refuses configuration first because it is about to spawn
 * workers; this is about to read four files.
 *
 * A durable-titled attachment outside the new manifest is reported and never
 * deleted. Restore ignores it because it is not in the committed generation;
 * deleting an attachment this run did not write would still be an unattended
 * destructive act on an outward surface.
 */
export const publishPlan = async ({ cwd, name, config, env, onProgress, titlePrefix }: Params): Promise<PublishReport> => {
	const durable = await durablePlanFiles({ cwd, name });

	if (durable.error !== undefined) {
		return { published: [], stale: [], error: durable.error };
	}

	const shipSettings = resolveShipSettings({ config });

	if (shipSettings === undefined) {
		return {
			published: [],
			stale: [],
			error: `ship.ticket-pattern is not a usable regular expression with a (?<ticket>) group, so publish cannot read a ticket id out of plan folder '${name}'`,
		};
	}

	const ticketRef = readPlanTicketRef({ name, ticketPattern: shipSettings.ticketPattern });

	if (ticketRef === undefined) {
		return {
			published: [],
			stale: [],
			error: `plan folder '${name}' carries no ticket id — name a plan folder after its ticket's branch so publish knows which ticket to attach to`,
		};
	}

	const prepared = await prepareAttachments({ files: durable.files, titlePrefix });

	if ('error' in prepared) {
		return { ticketRef, published: [], stale: [], error: prepared.error };
	}

	const settings = resolveTrackerSettings({ config, env });

	if ('error' in settings) {
		return { ticketRef, published: [], stale: [], error: settings.error };
	}

	const tickets = await getTicketsByIdentifiers({ settings, identifiers: [ticketRef] });

	if ('error' in tickets) {
		return { ticketRef, published: [], stale: [], error: tickets.error };
	}

	const ticket = tickets.at(0);

	if (ticket === undefined) {
		return { ticketRef, published: [], stale: [], error: `there is no ${ticketRef} on the configured ticket tracker` };
	}

	const { published, error } = await attachDurableFiles({
		settings,
		ticketId: ticket.id,
		ticketRef,
		attachments: prepared.attachments,
		onProgress,
		titlePrefix,
	});

	if (error !== undefined) {
		return { ticketRef, published, stale: [], error };
	}

	const stale = await reportStaleAttachments({ settings, ticketRef, published, onProgress, titlePrefix });
	const marker = prepared.attachments.at(-1);

	return titlePrefix === undefined || marker === undefined
		? { ticketRef, published, stale }
		: { ticketRef, published, stale, markerSha256: sha256({ content: marker.content }) };
};
