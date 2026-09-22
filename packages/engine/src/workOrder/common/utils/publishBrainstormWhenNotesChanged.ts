import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { brainstormAttachmentFileNames, brainstormAttachmentManifestName, publishBrainstorm } from '#src/brainstorm/index.ts';
import { attachmentTitle } from '#src/common/attachmentManifest/attachmentTitle.ts';
import { parseAttachmentManifest } from '#src/common/attachmentManifest/parseAttachmentManifest.ts';
import { scopeAttachments } from '#src/common/attachmentManifest/scopeAttachments.ts';
import { brainstormNotesFileName } from '#src/common/constants/brainstormNotesFileName.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { pathExists, planWorkspaceDir } from '#src/plan/index.ts';
import { getTicketAttachments, readTicketAsset } from '#src/ticketTracker/index.ts';
import type { TicketTrackerTarget } from '#src/workOrder/common/types/TicketTrackerTarget.ts';

interface Params {
	cwd: string;
	/** The plan's address, `<ticket-branch>/<plan-id>`. */
	address: string;
	planId: string;
	target: TicketTrackerTarget;
	config: LightsoutConfig;
	/** The process environment the tracker API key is read from. */
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

/** The SHA-256 the plan's own brainstorm marker commits for the notes, or undefined when nothing on the ticket commits them. */
const readCommittedNotesHash = async ({
	planId,
	target,
}: {
	planId: string;
	target: TicketTrackerTarget;
}): Promise<{ committed: string | undefined } | { error: string }> => {
	const { settings, ticketRef } = target;
	const attachments = await getTicketAttachments({ settings, identifier: ticketRef });

	if ('error' in attachments) {
		return { error: `the brainstorm generation on ${ticketRef} could not be read: ${attachments.error}` };
	}

	const scoped = scopeAttachments({ attachments, prefix: planId });
	const markers = scoped.filter(({ title }) => title === brainstormAttachmentManifestName);
	const marker = markers.length === 1 ? markers[0] : undefined;

	if (marker === undefined) {
		return { committed: undefined };
	}

	const text = await readTicketAsset({ settings, url: marker.url });

	if (typeof text !== 'string') {
		return { error: `the brainstorm generation on ${ticketRef} could not be read: ${text.error}` };
	}

	const parsed = parseAttachmentManifest({
		text,
		markerName: attachmentTitle({ prefix: planId, name: brainstormAttachmentManifestName }),
		isAllowedName: ({ name }) => brainstormAttachmentFileNames.includes(name),
	});

	// A marker that will not parse is healed by republishing over it, because
	// every title it names is replaced by the same publish.
	return { committed: 'error' in parsed ? undefined : parsed.manifest.files.find(({ name }) => name === brainstormNotesFileName)?.sha256 };
};

/**
 * Publish the plan's brainstorm generation first whenever the notes on disk are
 * not the bytes its own marker commits.
 *
 * `brainstorm-notes.md` belongs to the brainstorm generation now, so a plan
 * publish would otherwise leave a ticket whose plan is current and whose notes
 * are whatever was last brainstormed. Republishing only when the bytes differ
 * is what keeps `plan publish` from re-uploading the notes on every run.
 *
 * A plan folder with no notes is the ordinary case for a plan that was never
 * brainstormed, and publishes nothing.
 */
export const publishBrainstormWhenNotesChanged = async ({
	cwd,
	address,
	planId,
	target,
	config,
	env,
	onProgress,
}: Params): Promise<{ published: string[] } | { error: string }> => {
	const notesPath = join(await planWorkspaceDir({ cwd, name: address }), brainstormNotesFileName);

	if (!(await pathExists({ path: notesPath }))) {
		return { published: [] };
	}

	const committed = await readCommittedNotesHash({ planId, target });

	if ('error' in committed) {
		return committed;
	}

	const onDisk = sha256({ content: await readFile(notesPath) });

	if (committed.committed === onDisk) {
		return { published: [] };
	}

	const report = await publishBrainstorm({ cwd, name: address, config, env, onProgress: onProgress ?? (() => undefined), titlePrefix: planId });

	return report.error === undefined ? { published: report.published } : { error: report.error };
};
