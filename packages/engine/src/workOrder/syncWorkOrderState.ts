import { sha256 } from '#src/common/utils/sha256.ts';
import { workOrderFolderDir } from '#src/common/workspace/workOrderFolderDir.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import { WorkOrderSyncKeep } from '#src/workOrder/common/constants/WorkOrderSyncKeep.ts';
import { keepLocalWorkOrderState } from '#src/workOrder/divergence/keepLocalWorkOrderState.ts';
import { keepPublishedWorkOrderState } from '#src/workOrder/divergence/keepPublishedWorkOrderState.ts';
import { publishedButUnrecorded } from '#src/workOrder/internal/common/constants/publishedButUnrecorded.ts';
import { workOrderFileNames } from '#src/workOrder/internal/common/constants/workOrderFileNames.ts';
import type { TicketTrackerTarget } from '#src/workOrder/internal/common/types/TicketTrackerTarget.ts';
import { attachWorkOrderStateIfUnmoved } from '#src/workOrder/internal/common/utils/attachWorkOrderStateIfUnmoved.ts';
import { readWorkOrderSyncState } from '#src/workOrder/internal/common/utils/readWorkOrderSyncState.ts';
import { readWorkOrderWithTrackerTarget } from '#src/workOrder/internal/common/utils/readWorkOrderWithTrackerTarget.ts';
import { recordWorkOrderSyncState } from '#src/workOrder/internal/common/utils/recordWorkOrderSyncState.ts';
import { serializeWorkOrderState } from '#src/workOrder/internal/common/utils/serializeWorkOrderState.ts';
import { pullWorkOrderState } from '#src/workOrder/pullWorkOrderState.ts';

interface Params {
	/** Any checkout of the repository the command was launched from. */
	cwd: string;
	name: string;
	config: LightsoutConfig;
	/** The process environment the tracker API key is read from. */
	env: NodeJS.ProcessEnv;
	/** Which copy the human chose, when a divergence has already been surfaced. Absent asks for the ordinary pull-and-catch-up. */
	keep: WorkOrderSyncKeep | undefined;
	onProgress?: (message: string) => void;
}

/**
 * The ordinary sync: pull, and publish a local record that has moved since this
 * machine last sent one.
 *
 * This is how a publish that failed earlier is retried — the sidecar still
 * names older bytes than the record, which is exactly the state a failed
 * publish leaves behind.
 */
const catchUpTicketRecord = async ({
	cwd,
	name,
	config,
	env,
	target,
	onProgress,
}: {
	cwd: string;
	name: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	target: TicketTrackerTarget;
	onProgress?: (message: string) => void;
}): Promise<{ record: WorkOrderState } | { error: string }> => {
	const pulled = await pullWorkOrderState({ cwd, name, config, env, onProgress });

	if ('error' in pulled) {
		return pulled;
	}

	if (pulled.record === undefined) {
		return { error: `there is no ${workOrderFileNames.record} for '${name}' on this machine or on ${target.ticketRef}, so there is nothing to sync` };
	}

	const workOrderFolder = await workOrderFolderDir({ cwd, name });
	const syncState = await readWorkOrderSyncState({ workOrderFolder });
	const localSha256 = sha256({ content: serializeWorkOrderState({ record: pulled.record }) });

	if (localSha256 === syncState?.recordSha256) {
		onProgress?.(`the work order state for '${name}' already matches the copy on ${target.ticketRef}`);

		return { record: pulled.record };
	}

	const attached = await attachWorkOrderStateIfUnmoved({ cwd, name, target, expectedPublishedSha256: syncState?.recordSha256, onProgress });

	if ('error' in attached) {
		return attached;
	}

	const recorded = await recordWorkOrderSyncState({ workOrderFolder, recordSha256: attached.attachedSha256, failure: publishedButUnrecorded });

	return recorded === undefined ? { record: pulled.record } : recorded;
};

/**
 * Bring this machine's work order state and the ticket's own copy back into
 * agreement — by catching up, or by the choice a human made about a divergence.
 *
 * Syncing is the one command whose whole subject is the tracker, so a work
 * order with nowhere to publish to is refused by name rather than quietly
 * answered from local files. Without `--keep` it does what every other command's pull
 * does and then sends anything this machine still owes; with `--keep` it
 * carries out a decision, which is the only way a divergence is ever resolved.
 */
export const syncWorkOrderState = async ({ cwd, name, config, env, keep, onProgress }: Params): Promise<{ record: WorkOrderState } | { error: string }> => {
	const opened = await readWorkOrderWithTrackerTarget({ cwd, name, config, env });

	if ('error' in opened) {
		return opened;
	}

	const { record, target } = opened;

	if ('localOnly' in target) {
		// A work order with no record at all has nothing to sync, rather than
		// nowhere to publish: the ticket it belongs to is what the record would
		// have said, so no tracker can be asked on its behalf.
		return record === undefined
			? { error: `there is no ${workOrderFileNames.record} for '${name}' on this machine, so there is nothing to sync` }
			: { error: `${target.localOnly} — \`lightsout work-order sync\` needs a configured tracker to sync against` };
	}

	if (keep === WorkOrderSyncKeep.Published) {
		return keepPublishedWorkOrderState({ cwd, name, config, env, target, onProgress });
	}

	if (keep === WorkOrderSyncKeep.Local) {
		return keepLocalWorkOrderState({ cwd, name, config, env, target, onProgress });
	}

	return catchUpTicketRecord({ cwd, name, config, env, target, onProgress });
};
