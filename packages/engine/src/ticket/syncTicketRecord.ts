import { sha256 } from '#src/common/utils/sha256.ts';
import { ticketFolderDir } from '#src/common/workspace/ticketFolderDir.ts';
import type { LightsoutConfig, TicketRecord } from '#src/contracts/index.ts';
import { publishedButUnrecorded } from '#src/ticket/common/constants/publishedButUnrecorded.ts';
import { TicketSyncKeep } from '#src/ticket/common/constants/TicketSyncKeep.ts';
import { ticketFileNames } from '#src/ticket/common/constants/ticketFileNames.ts';
import type { TicketTrackerTarget } from '#src/ticket/common/types/TicketTrackerTarget.ts';
import { attachTicketRecordIfUnmoved } from '#src/ticket/common/utils/attachTicketRecordIfUnmoved.ts';
import { readTicketSyncState } from '#src/ticket/common/utils/readTicketSyncState.ts';
import { recordTicketSyncState } from '#src/ticket/common/utils/recordTicketSyncState.ts';
import { resolveTicketTrackerTarget } from '#src/ticket/common/utils/resolveTicketTrackerTarget.ts';
import { serializeTicketRecord } from '#src/ticket/common/utils/serializeTicketRecord.ts';
import { keepLocalTicketRecord, keepPublishedTicketRecord } from '#src/ticket/divergence/index.ts';
import { pullTicketRecord } from '#src/ticket/pullTicketRecord.ts';

interface Params {
	/** Any checkout of the repository the command was launched from. */
	cwd: string;
	ticketBranch: string;
	config: LightsoutConfig;
	/** The process environment the tracker API key is read from. */
	env: NodeJS.ProcessEnv;
	/** Which copy the human chose, when a divergence has already been surfaced. Absent asks for the ordinary pull-and-catch-up. */
	keep: TicketSyncKeep | undefined;
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
	ticketBranch,
	config,
	env,
	target,
	onProgress,
}: {
	cwd: string;
	ticketBranch: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	target: TicketTrackerTarget;
	onProgress?: (message: string) => void;
}): Promise<{ record: TicketRecord } | { error: string }> => {
	const pulled = await pullTicketRecord({ cwd, ticketBranch, config, env, onProgress });

	if ('error' in pulled) {
		return pulled;
	}

	if (pulled.record === undefined) {
		return { error: `there is no ${ticketFileNames.record} for '${ticketBranch}' on this machine or on ${target.ticketRef}, so there is nothing to sync` };
	}

	const ticketFolder = await ticketFolderDir({ cwd, ticketBranch });
	const syncState = await readTicketSyncState({ ticketFolder });
	const localSha256 = sha256({ content: serializeTicketRecord({ record: pulled.record }) });

	if (localSha256 === syncState?.recordSha256) {
		onProgress?.(`the ticket record for '${ticketBranch}' already matches the copy on ${target.ticketRef}`);

		return { record: pulled.record };
	}

	const attached = await attachTicketRecordIfUnmoved({ cwd, ticketBranch, target, expectedPublishedSha256: syncState?.recordSha256, onProgress });

	if ('error' in attached) {
		return attached;
	}

	const recorded = await recordTicketSyncState({ ticketFolder, recordSha256: attached.attachedSha256, failure: publishedButUnrecorded });

	return recorded === undefined ? { record: pulled.record } : recorded;
};

/**
 * Bring this machine's ticket record and the ticket's own copy back into
 * agreement — by catching up, or by the choice a human made about a divergence.
 *
 * Syncing is the one command whose whole subject is the tracker, so a ticket
 * with nowhere to publish to is refused by name rather than quietly answered
 * from local files. Without `--keep` it does what every other command's pull
 * does and then sends anything this machine still owes; with `--keep` it
 * carries out a decision, which is the only way a divergence is ever resolved.
 */
export const syncTicketRecord = async ({ cwd, ticketBranch, config, env, keep, onProgress }: Params): Promise<{ record: TicketRecord } | { error: string }> => {
	const target = resolveTicketTrackerTarget({ config, env, ticketBranch });

	if ('error' in target) {
		return target;
	}

	if ('localOnly' in target) {
		return { error: `${target.localOnly} — \`lightsout work-order sync\` needs a configured tracker to sync against` };
	}

	if (keep === TicketSyncKeep.Published) {
		return keepPublishedTicketRecord({ cwd, ticketBranch, config, env, target, onProgress });
	}

	if (keep === TicketSyncKeep.Local) {
		return keepLocalTicketRecord({ cwd, ticketBranch, config, env, target, onProgress });
	}

	return catchUpTicketRecord({ cwd, ticketBranch, config, env, target, onProgress });
};
