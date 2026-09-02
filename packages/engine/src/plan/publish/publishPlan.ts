import { readFile } from 'node:fs/promises';
import { messageOf } from '#src/common/utils/messageOf.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { durablePlanFileNames } from '#src/plan/common/constants/durablePlanFileNames.ts';
import { planAttachmentManifestName, serializePlanAttachmentManifest } from '#src/plan/common/planAttachmentManifest.ts';
import type { DurablePlanFile } from '#src/plan/common/types/DurablePlanFile.ts';
import { validatePlanAttachmentGeneration } from '#src/plan/common/validatePlanAttachmentGeneration.ts';
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
	/** Each published attachment's own name, ending with the generation commit marker. */
	published: string[];
	/** Durable-titled attachments outside the committed generation. Reported, never deleted. */
	stale: string[];
	/** Set when the publish stopped — the one sentence saying why. */
	error?: string;
}

/** The tracker previews an attachment by its content type, and the durable set holds only these two shapes. */
const contentTypeOf = ({ name }: { name: string }) => (name.endsWith('.json') ? 'application/json' : 'text/markdown');

interface PreparedAttachment {
	name: string;
	content: Buffer;
}

/**
 * Read a complete immutable snapshot before the first outward mutation, then
 * append the manifest that commits exactly those bytes.
 */
const prepareAttachments = async ({ files }: { files: DurablePlanFile[] }): Promise<{ attachments: PreparedAttachment[] } | { error: string }> => {
	const durable: PreparedAttachment[] = [];

	for (const file of files) {
		try {
			durable.push({ name: file.name, content: await readFile(file.path) });
		} catch (error) {
			return { error: `could not read ${file.name} before publishing: ${messageOf({ error })}` };
		}
	}

	const refusal = validatePlanAttachmentGeneration({ files: durable.map(({ name, content }) => ({ name, text: content.toString('utf8') })) });

	if (refusal !== undefined) {
		return refusal;
	}

	return {
		attachments: [...durable, { name: planAttachmentManifestName, content: serializePlanAttachmentManifest({ files: durable }) }],
	};
};

/** Attach the prepared snapshot in order, with its manifest last, stopping at the first tracker refusal. */
const attachDurableFiles = async ({
	settings,
	ticketId,
	ticketRef,
	attachments,
	onProgress,
}: {
	settings: TrackerSettings;
	ticketId: string;
	ticketRef: string;
	attachments: PreparedAttachment[];
	onProgress: (message: string) => void;
}) => {
	const published: string[] = [];

	for (const attachment of attachments) {
		const failure = await setTicketAttachment({
			settings,
			ticketId,
			title: attachment.name,
			content: attachment.content,
			contentType: contentTypeOf({ name: attachment.name }),
		});

		// A stopped loop keeps what did land, so a partial publish is visible
		// rather than silent.
		if (failure !== undefined) {
			return { published, error: failure.error };
		}

		published.push(attachment.name);
		onProgress(`attached ${attachment.name} to ${ticketRef}`);
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

	const prepared = await prepareAttachments({ files: durable.files });

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

	const { published, error } = await attachDurableFiles({ settings, ticketId: ticket.id, ticketRef, attachments: prepared.attachments, onProgress });

	if (error !== undefined) {
		return { ticketRef, published, stale: [], error };
	}

	const stale = await reportStaleAttachments({ settings, ticketRef, published, onProgress });

	return { ticketRef, published, stale };
};
