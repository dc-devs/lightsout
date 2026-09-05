import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { brainstormAttachmentFileNames } from '#src/brainstorm/common/constants/brainstormAttachmentFileNames.ts';
import { brainstormAttachmentManifestName } from '#src/brainstorm/common/constants/brainstormAttachmentManifestName.ts';
import { serializeAttachmentManifest } from '#src/common/attachmentManifest/serializeAttachmentManifest.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { planWorkspaceDir, readPlanTicketRef } from '#src/plan/index.ts';
import { resolveShipSettings } from '#src/ship/index.ts';
import { getTicketsByIdentifiers, resolveTrackerSettings, setTicketAttachment, type TrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — the folder the brainstorm's own files live in. */
	name: string;
	config: LightsoutConfig;
	/** The process environment the tracker API key is read from. */
	env: NodeJS.ProcessEnv;
	onProgress: (message: string) => void;
}

interface BrainstormPublishReport {
	/** The ticket the files landed on, e.g. 'LO-117'. Absent when nothing was published. */
	ticketRef?: string;
	/** Each published attachment's own name, ending with the generation commit marker. */
	published: string[];
	/** Set when the publish stopped — the one sentence saying why. */
	error?: string;
}

interface PreparedAttachment {
	name: string;
	content: Buffer;
}

/** The tracker previews an attachment by its content type, and this generation holds only these two shapes. */
const contentTypeOf = ({ name }: { name: string }) => (name.endsWith('.json') ? 'application/json' : 'text/markdown');

/** Read both files as one snapshot before any outward mutation, then append the marker committing exactly those bytes. */
const prepareAttachments = async ({ dir }: { dir: string }): Promise<{ attachments: PreparedAttachment[] } | { error: string }> => {
	const files: PreparedAttachment[] = [];

	for (const name of brainstormAttachmentFileNames) {
		try {
			files.push({ name, content: await readFile(join(dir, name)) });
		} catch (error) {
			return { error: `could not read ${name} from ${dir} — run the \`brainstorm\` skill first: ${messageOf({ error })}` };
		}
	}

	return { attachments: [...files, { name: brainstormAttachmentManifestName, content: serializeAttachmentManifest({ files }) }] };
};

/** Attach the prepared snapshot in order, with its marker last, stopping at the first tracker refusal. */
const attachBrainstormFiles = async ({
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

/**
 * Put a brainstorm folder's two files on the ticket the folder is named after,
 * committing their exact names and hashes with `brainstorm-attachments.json`
 * attached last.
 *
 * The refusals are ordered the way `publishPlan` orders its own — disk, then
 * the folder's name, then configuration, then the network — so the two failures
 * a user actually hits are answered with no round trip.
 *
 * No stale attachment is reported and none can exist: the set is two fixed
 * names, so a re-publish replaces both same-titled attachments and leaves
 * nothing over.
 */
export const publishBrainstorm = async ({ cwd, name, config, env, onProgress }: Params): Promise<BrainstormPublishReport> => {
	const prepared = await prepareAttachments({ dir: planWorkspaceDir({ cwd, name }) });

	if ('error' in prepared) {
		return { published: [], error: prepared.error };
	}

	const shipSettings = resolveShipSettings({ config });

	if (shipSettings === undefined) {
		return {
			published: [],
			error: `ship.ticket-pattern is not a usable regular expression with a (?<ticket>) group, so brainstorm publish cannot read a ticket id out of plan folder '${name}'`,
		};
	}

	const ticketRef = readPlanTicketRef({ name, ticketPattern: shipSettings.ticketPattern });

	if (ticketRef === undefined) {
		return {
			published: [],
			error: `plan folder '${name}' carries no ticket id — name a plan folder after its ticket's branch so brainstorm publish knows which ticket to attach to`,
		};
	}

	const settings = resolveTrackerSettings({ config, env });

	if ('error' in settings) {
		return { ticketRef, published: [], error: settings.error };
	}

	const tickets = await getTicketsByIdentifiers({ settings, identifiers: [ticketRef] });

	if ('error' in tickets) {
		return { ticketRef, published: [], error: tickets.error };
	}

	const ticket = tickets.at(0);

	if (ticket === undefined) {
		return { ticketRef, published: [], error: `there is no ${ticketRef} on the configured ticket tracker` };
	}

	const { published, error } = await attachBrainstormFiles({ settings, ticketId: ticket.id, ticketRef, attachments: prepared.attachments, onProgress });

	return error === undefined ? { ticketRef, published } : { ticketRef, published, error };
};
