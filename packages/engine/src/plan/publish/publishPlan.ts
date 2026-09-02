import { readFile } from 'node:fs/promises';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { durablePlanFileNames } from '#src/plan/common/constants/durablePlanFileNames.ts';
import type { DurablePlanFile } from '#src/plan/common/types/DurablePlanFile.ts';
import { durablePlanFiles } from '#src/plan/publish/durablePlanFiles.ts';
import { readPlanTicketRef } from '#src/plan/readPlanTicketRef.ts';
import { resolveShipSettings } from '#src/ship/index.ts';
import { getTicketAttachments, getTicketsByIdentifiers, resolveTrackerSettings, setTicketAttachment, type TrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
	config: LightsoutConfig;
	/** The process environment the tracker API key is read from. Passed rather than read, so a test never mutates `process.env`. */
	env: NodeJS.ProcessEnv;
	onProgress: (message: string) => void;
}

interface PublishReport {
	/** The ticket the files landed on, e.g. 'LO-54'. Absent when nothing was published. */
	ticketRef?: string;
	/** Each published file's own name, in the order it was attached. */
	published: string[];
	/** Durable-titled attachments already on the ticket that this run did not write. Reported, never deleted. */
	stale: string[];
	/** Set when the publish stopped — the one sentence saying why. */
	error?: string;
}

/** The tracker previews an attachment by its content type, and the durable set holds only these two shapes. */
const contentTypeOf = ({ name }: { name: string }) => (name.endsWith('.json') ? 'application/json' : 'text/markdown');

/** Attach each durable file in order, stopping at the first one the tracker refused. */
const attachDurableFiles = async ({
	settings,
	ticketId,
	ticketRef,
	files,
	onProgress,
}: {
	settings: TrackerSettings;
	ticketId: string;
	ticketRef: string;
	files: DurablePlanFile[];
	onProgress: (message: string) => void;
}) => {
	const published: string[] = [];

	for (const file of files) {
		const content = await readFile(file.path);
		const failure = await setTicketAttachment({ settings, ticketId, title: file.name, content, contentType: contentTypeOf({ name: file.name }) });

		// A stopped loop keeps what did land, so a partial publish is visible
		// rather than silent.
		if (failure !== undefined) {
			return { published, error: failure.error };
		}

		published.push(file.name);
		onProgress(`attached ${file.name} to ${ticketRef}`);
	}

	return { published, error: undefined };
};

/** Every attachment title on the ticket that names a durable plan file this run did not write. */
const readStaleTitles = ({ titles, published }: { titles: string[]; published: string[] }) =>
	titles.filter((title) => !published.includes(title) && (durablePlanFileNames.records.includes(title) || durablePlanFileNames.deliverable.test(title)));

/**
 * Name the durable-titled attachments an earlier publish left on the ticket,
 * and answer with them.
 *
 * The read is advisory: one that did not come back reports itself and answers
 * with nothing, because the files are already on the ticket and a publish that
 * succeeded must not be turned into a reported failure by it.
 */
const reportStaleAttachments = async ({
	settings,
	ticketRef,
	published,
	onProgress,
}: {
	settings: TrackerSettings;
	ticketRef: string;
	published: string[];
	onProgress: (message: string) => void;
}) => {
	const attachments = await getTicketAttachments({ settings, identifier: ticketRef });

	if ('error' in attachments) {
		onProgress(`could not read ${ticketRef}'s attachment list back: ${attachments.error}`);

		return [];
	}

	const stale = readStaleTitles({ titles: attachments.map((attachment) => attachment.title), published });

	for (const title of stale) {
		onProgress(`${title} is a plan file from an earlier publish that this run did not write — it is still on ${ticketRef}, and publish deleted nothing`);
	}

	return stale;
};

/**
 * Put a plan folder's durable set on the ticket the folder is named after.
 *
 * The refusals are ordered disk first, then the folder's own name, then
 * configuration, then the network: the first two are answered with no config
 * and no round trip, and "this folder holds no plan" is the failure a user hits
 * most. The queue refuses configuration first because it is about to spawn
 * workers; this is about to read four files.
 *
 * A durable-titled attachment an earlier publish left behind is reported and
 * never deleted. Deleting an attachment this run did not write would be an
 * unattended destructive act on an outward surface, and a person may have
 * attached their own `notes.md` under exactly such a name.
 */
export const publishPlan = async ({ cwd, name, config, env, onProgress }: Params): Promise<PublishReport> => {
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
		return { ticketRef, published: [], stale: [], error: `there is no ${ticketRef} on the configured tracker team` };
	}

	const { published, error } = await attachDurableFiles({ settings, ticketId: ticket.id, ticketRef, files: durable.files, onProgress });

	if (error !== undefined) {
		return { ticketRef, published, stale: [], error };
	}

	const stale = await reportStaleAttachments({ settings, ticketRef, published, onProgress });

	return { ticketRef, published, stale };
};
