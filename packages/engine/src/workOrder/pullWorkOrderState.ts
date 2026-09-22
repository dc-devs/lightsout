import { join } from 'node:path';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { workOrderFolderDir } from '#src/common/workspace/workOrderFolderDir.ts';
import type { LightsoutConfig, WorkOrderState } from '#src/contracts/index.ts';
import { workOrderFileNames } from '#src/workOrder/common/constants/workOrderFileNames.ts';
import type { PublishedWorkOrderState } from '#src/workOrder/common/types/PublishedWorkOrderState.ts';
import { readPublishedWorkOrderState } from '#src/workOrder/common/utils/readPublishedWorkOrderState.ts';
import { readWorkOrderSyncState } from '#src/workOrder/common/utils/readWorkOrderSyncState.ts';
import { resolveWorkOrderTrackerTarget } from '#src/workOrder/common/utils/resolveWorkOrderTrackerTarget.ts';
import { serializeWorkOrderState } from '#src/workOrder/common/utils/serializeWorkOrderState.ts';
import { surfaceWorkOrderDivergence } from '#src/workOrder/common/utils/surfaceWorkOrderDivergence.ts';
import { updateWorkOrderSyncState } from '#src/workOrder/common/utils/updateWorkOrderSyncState.ts';
import { withWorkOrderStateLock } from '#src/workOrder/common/utils/withWorkOrderStateLock.ts';
import { writeWorkOrderFolderFile } from '#src/workOrder/common/utils/writeWorkOrderFolderFile.ts';
import { readWorkOrderState } from '#src/workOrder/readWorkOrderState.ts';

interface Params {
	/** Any checkout of the repository: the one record this machine holds is found from it. */
	cwd: string;
	/** The work order's label, which is also the branch its plans implement on. */
	name: string;
	config: LightsoutConfig;
	/** The process environment the tracker API key is read from. */
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

/** Take the ticket's copy: write it as the local record, and remember its bytes as the last synced ones. */
const takePublished = async ({
	workOrderFolder,
	content,
	record,
	ticketRef,
	onProgress,
}: {
	workOrderFolder: string;
	content: Buffer;
	record: WorkOrderState;
	ticketRef: string;
	onProgress?: (message: string) => void;
}) => {
	let outcome: { record: WorkOrderState } | { error: string };

	try {
		await writeWorkOrderFolderFile({ path: join(workOrderFolder, workOrderFileNames.record), content });
		await updateWorkOrderSyncState({ workOrderFolder, recordSha256: sha256({ content }) });

		outcome = { record };
	} catch (error) {
		outcome = { error: `the ${workOrderFileNames.record} published on ${ticketRef} could not be written into ${workOrderFolder}: ${messageOf({ error })}` };
	}

	if ('record' in outcome) {
		onProgress?.(`took the work order state published on ${ticketRef}`);
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
	workOrderFolder,
	name,
	ticketRef,
	published,
	onProgress,
}: {
	cwd: string;
	workOrderFolder: string;
	name: string;
	ticketRef: string;
	published: PublishedWorkOrderState | undefined;
	onProgress?: (message: string) => void;
}): Promise<{ record: WorkOrderState | undefined } | { error: string }> => {
	const local = await readWorkOrderState({ cwd, name });

	if ('error' in local) {
		return local;
	}

	if (published === undefined) {
		return { record: local.record };
	}

	const syncState = await readWorkOrderSyncState({ workOrderFolder });
	const publishedSha256 = sha256({ content: published.content });
	const localSha256 = local.record === undefined ? undefined : sha256({ content: serializeWorkOrderState({ record: local.record }) });
	const take = () => takePublished({ workOrderFolder, content: published.content, record: published.record, ticketRef, onProgress });
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
		outcome = { error: await surfaceWorkOrderDivergence({ workOrderFolder, name, ticketRef, content: published.content }) };
	}

	return outcome;
};

/**
 * The work order's state as this machine should now see it: its own copy, the
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
export const pullWorkOrderState = async ({
	cwd,
	name,
	config,
	env,
	onProgress,
}: Params): Promise<{ record: WorkOrderState | undefined } | { error: string }> => {
	const target = resolveWorkOrderTrackerTarget({ config, env, name });

	if ('error' in target) {
		return target;
	}

	if ('localOnly' in target) {
		return readWorkOrderState({ cwd, name });
	}

	const published = await readPublishedWorkOrderState({ target, name });

	if ('error' in published) {
		return published;
	}

	const workOrderFolder = await workOrderFolderDir({ cwd, name });

	return withWorkOrderStateLock({
		workOrderFolder,
		run: () => applyThreeWayRule({ cwd, workOrderFolder, name, ticketRef: target.ticketRef, published: published.published, onProgress }),
	});
};
