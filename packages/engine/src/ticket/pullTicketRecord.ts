import { join } from 'node:path';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { ticketFolderDir } from '#src/common/workspace/ticketFolderDir.ts';
import type { LightsoutConfig, WorkOrderState } from '#src/contracts/index.ts';
import { ticketFileNames } from '#src/ticket/common/constants/ticketFileNames.ts';
import type { PublishedTicketRecord } from '#src/ticket/common/types/PublishedTicketRecord.ts';
import { readPublishedTicketRecord } from '#src/ticket/common/utils/readPublishedTicketRecord.ts';
import { readTicketSyncState } from '#src/ticket/common/utils/readTicketSyncState.ts';
import { resolveTicketTrackerTarget } from '#src/ticket/common/utils/resolveTicketTrackerTarget.ts';
import { serializeTicketRecord } from '#src/ticket/common/utils/serializeTicketRecord.ts';
import { surfaceTicketDivergence } from '#src/ticket/common/utils/surfaceTicketDivergence.ts';
import { updateTicketSyncState } from '#src/ticket/common/utils/updateTicketSyncState.ts';
import { withTicketRecordLock } from '#src/ticket/common/utils/withTicketRecordLock.ts';
import { writeTicketFolderFile } from '#src/ticket/common/utils/writeTicketFolderFile.ts';
import { readTicketRecord } from '#src/ticket/readTicketRecord.ts';

interface Params {
	/** Any checkout of the repository: the one record this machine holds is found from it. */
	cwd: string;
	/** The ticket folder's name, which is also the branch its plans implement on. */
	ticketBranch: string;
	config: LightsoutConfig;
	/** The process environment the tracker API key is read from. */
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

/** Take the ticket's copy: write it as the local record, and remember its bytes as the last synced ones. */
const takePublished = async ({
	ticketFolder,
	content,
	record,
	ticketRef,
	onProgress,
}: {
	ticketFolder: string;
	content: Buffer;
	record: WorkOrderState;
	ticketRef: string;
	onProgress?: (message: string) => void;
}) => {
	let outcome: { record: WorkOrderState } | { error: string };

	try {
		await writeTicketFolderFile({ path: join(ticketFolder, ticketFileNames.record), content });
		await updateTicketSyncState({ ticketFolder, recordSha256: sha256({ content }) });

		outcome = { record };
	} catch (error) {
		outcome = { error: `the ${ticketFileNames.record} published on ${ticketRef} could not be written into ${ticketFolder}: ${messageOf({ error })}` };
	}

	if ('record' in outcome) {
		onProgress?.(`took the ticket record published on ${ticketRef}`);
	}

	return outcome;
};

/**
 * The three-way rule, applied to bytes rather than fields: L is the local
 * record's normalised form, P the published one's, and S what the sidecar says
 * this machine last published or restored.
 */
const applyThreeWayRule = async ({
	cwd,
	ticketFolder,
	ticketBranch,
	ticketRef,
	published,
	onProgress,
}: {
	cwd: string;
	ticketFolder: string;
	ticketBranch: string;
	ticketRef: string;
	published: PublishedTicketRecord | undefined;
	onProgress?: (message: string) => void;
}): Promise<{ record: WorkOrderState | undefined } | { error: string }> => {
	const local = await readTicketRecord({ cwd, ticketBranch });

	if ('error' in local) {
		return local;
	}

	if (published === undefined) {
		return { record: local.record };
	}

	const syncState = await readTicketSyncState({ ticketFolder });
	const publishedSha256 = sha256({ content: published.content });
	const localSha256 = local.record === undefined ? undefined : sha256({ content: serializeTicketRecord({ record: local.record }) });
	const take = () => takePublished({ ticketFolder, content: published.content, record: published.record, ticketRef, onProgress });
	let outcome: { record: WorkOrderState | undefined } | { error: string };

	if (local.record === undefined || localSha256 === syncState?.recordSha256) {
		// Nothing local to lose, or only the ticket moved since the last sync.
		outcome = await take();
	} else if (localSha256 === publishedSha256) {
		// The two agree however they got there; recording the hash is what makes
		// the next change on either side answerable rather than a divergence.
		outcome = syncState?.recordSha256 === publishedSha256 ? { record: local.record } : await take();
	} else if (publishedSha256 === syncState?.recordSha256) {
		// Only this machine moved: its copy stands, and nothing is written.
		outcome = { record: local.record };
	} else {
		outcome = { error: await surfaceTicketDivergence({ ticketFolder, ticketBranch, ticketRef, content: published.content }) };
	}

	return outcome;
};

/**
 * The ticket's record as this machine should now see it: its own copy, the
 * ticket's copy pulled down over it, or the one sentence saying both have moved.
 *
 * Every command that reads or changes the record starts here, so a machine
 * never works from a copy it already knows is behind. With no tracker
 * configured — or a folder name carrying no ticket id — the local record is the
 * whole truth and nothing is reached for; a tracker that IS configured and
 * cannot be read is an error rather than a quiet local-only answer, because
 * passing over it would let a divergence go unnoticed.
 *
 * The tracker is read before the lock is taken and never while it is held: the
 * lock guards a read-modify-write of local files, and holding it across a
 * network call would stall every other command on this machine.
 */
export const pullTicketRecord = async ({
	cwd,
	ticketBranch,
	config,
	env,
	onProgress,
}: Params): Promise<{ record: WorkOrderState | undefined } | { error: string }> => {
	const target = resolveTicketTrackerTarget({ config, env, ticketBranch });

	if ('error' in target) {
		return target;
	}

	if ('localOnly' in target) {
		return readTicketRecord({ cwd, ticketBranch });
	}

	const published = await readPublishedTicketRecord({ target, ticketBranch });

	if ('error' in published) {
		return published;
	}

	const ticketFolder = await ticketFolderDir({ cwd, ticketBranch });

	return withTicketRecordLock({
		ticketFolder,
		run: () => applyThreeWayRule({ cwd, ticketFolder, ticketBranch, ticketRef: target.ticketRef, published: published.published, onProgress }),
	});
};
