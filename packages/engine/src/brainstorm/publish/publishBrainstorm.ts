import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { brainstormAttachmentFileNames } from '#src/brainstorm/common/constants/brainstormAttachmentFileNames.ts';
import { brainstormAttachmentManifestName } from '#src/brainstorm/common/constants/brainstormAttachmentManifestName.ts';
import { attachmentTitle } from '#src/common/attachmentManifest/attachmentTitle.ts';
import { serializeAttachmentManifest } from '#src/common/attachmentManifest/serializeAttachmentManifest.ts';
import { brainstormNotesFileName } from '#src/common/constants/brainstormNotesFileName.ts';
import { workOrderNameOf } from '#src/common/planAddress/workOrderNameOf.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { planWorkspaceDir, readPlanWorkOrderRef } from '#src/plan/index.ts';
import { getTicketsByIdentifiers, resolveTrackerSettings, setTicketAttachment, type TrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — the folder the brainstorm's own files live in. */
	name: string;
	config: LightsoutConfig;
	/** The process environment the tracker API key is read from. */
	env: NodeJS.ProcessEnv;
	onProgress: (message: string) => void;
	/** The plan id every attachment title is namespaced under; absent for a legacy folder, whose titles stay bare. */
	titlePrefix?: string;
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

/**
 * Read the generation as one snapshot before any outward mutation, then append
 * the marker committing exactly those bytes.
 *
 * Under a prefix only `brainstorm-notes.md` is required: a plan inside a ticket
 * folder may be shaped by a brainstorm that settled no decision of its own, and
 * refusing that would leave the notes unpublishable. A legacy folder still owes
 * both files, exactly as it always has.
 */
const prepareAttachments = async ({
	dir,
	titlePrefix,
}: {
	dir: string;
	titlePrefix?: string;
}): Promise<{ attachments: PreparedAttachment[] } | { error: string }> => {
	const files: PreparedAttachment[] = [];

	for (const name of brainstormAttachmentFileNames) {
		const content = await readFile(join(dir, name)).catch((error: unknown) => ({ error: messageOf({ error }) }));
		const optional = titlePrefix !== undefined && name !== brainstormNotesFileName;

		if (Buffer.isBuffer(content)) {
			files.push({ name, content });
		} else if (!optional) {
			return { error: `could not read ${name} from ${dir} — run the \`brainstorm\` skill first: ${content.error}` };
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
	titlePrefix,
}: {
	settings: TrackerSettings;
	ticketId: string;
	ticketRef: string;
	attachments: PreparedAttachment[];
	onProgress: (message: string) => void;
	titlePrefix?: string;
}) => {
	const published: string[] = [];

	for (const attachment of attachments) {
		const title = attachmentTitle({ prefix: titlePrefix, name: attachment.name });
		const failure = await setTicketAttachment({
			settings,
			ticketId,
			title,
			content: attachment.content,
			contentType: contentTypeOf({ name: attachment.name }),
		});

		// A stopped loop keeps what did land, so a partial publish is visible
		// rather than silent.
		if (failure !== undefined) {
			return { published, error: failure.error };
		}

		published.push(title);
		onProgress(`attached ${title} to ${ticketRef}`);
	}

	return { published, error: undefined };
};

/**
 * Put a brainstorm folder's two files on the ticket its work order's record
 * names, committing their exact names and hashes with
 * `brainstorm-attachments.json` attached last.
 *
 * The refusals are ordered the way `publishPlan` orders its own — disk, then
 * the work order's record, then configuration, then the network — so the two
 * failures a user actually hits are answered with no round trip.
 *
 * No stale attachment is reported, and for a legacy folder none can exist: the
 * set is two fixed names, so a re-publish replaces both same-titled attachments
 * and leaves nothing over. Under a prefix a republish without
 * `brainstorm-decisions.json` does leave that plan's earlier copy of it on the
 * ticket — restore ignores it, because the marker written last does not list it.
 */
export const publishBrainstorm = async ({ cwd, name, config, env, onProgress, titlePrefix }: Params): Promise<BrainstormPublishReport> => {
	const prepared = await prepareAttachments({ dir: await planWorkspaceDir({ cwd, name }), titlePrefix });

	if ('error' in prepared) {
		return { published: [], error: prepared.error };
	}

	const ticketRef = await readPlanWorkOrderRef({ cwd, name });

	if (ticketRef === undefined) {
		return {
			published: [],
			error: `the brainstorm for '${name}' cannot be published: work order '${workOrderNameOf({ name })}' carries no ticket reference in its record, so it belongs to no ticket`,
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

	const { published, error } = await attachBrainstormFiles({
		settings,
		ticketId: ticket.id,
		ticketRef,
		attachments: prepared.attachments,
		onProgress,
		titlePrefix,
	});

	return error === undefined ? { ticketRef, published } : { ticketRef, published, error };
};
