import { resolveSharedStateDir } from '#src/common/workspace/resolveSharedStateDir.ts';
import type { LightsoutConfig, TicketRecord } from '#src/contracts/index.ts';
import { publishedButUnrecorded } from '#src/ticket/common/constants/publishedButUnrecorded.ts';
import { attachTicketRecordIfUnmoved } from '#src/ticket/common/utils/attachTicketRecordIfUnmoved.ts';
import { getTicketFolderPath } from '#src/ticket/common/utils/getTicketFolderPath.ts';
import { readTicketSyncState } from '#src/ticket/common/utils/readTicketSyncState.ts';
import { recordTicketSyncState } from '#src/ticket/common/utils/recordTicketSyncState.ts';
import { resolveTicketTrackerTarget } from '#src/ticket/common/utils/resolveTicketTrackerTarget.ts';
import { pullTicketRecord } from '#src/ticket/pullTicketRecord.ts';
import { updateLocalTicketRecord } from '#src/ticket/updateLocalTicketRecord.ts';

interface Params {
	/** Any checkout of the repository: the one record this machine holds is found from it. */
	cwd: string;
	ticketBranch: string;
	config: LightsoutConfig;
	/** The process environment the tracker API key is read from. */
	env: NodeJS.ProcessEnv;
	/** The same pure change `updateLocalTicketRecord` takes, run under the record's lock once the pull has settled what "now" is. */
	change: (current: TicketRecord | undefined) => TicketRecord | { error: string };
	onProgress?: (message: string) => void;
}

/**
 * Change a ticket's record and put the result on the ticket: pull, change under
 * the record's lock, publish.
 *
 * Every `lightsout ticket` subcommand that changes the record goes through
 * here, which is what makes "the local files are the working state and the
 * tracker is the recoverable copy" true of all of them at once. The pull runs
 * first so the change is made against what the ticket actually carries rather
 * than a copy this machine may already be behind; a divergence stops everything
 * with the change never run.
 *
 * A change that reached disk but not the tracker is answered as `publishError`
 * rather than as a failure: the change HAS happened locally, and pretending
 * otherwise would invite a caller to make it twice. The sidecar is left as it
 * was, so the next `lightsout ticket sync` sees this machine ahead and retries.
 */
export const updateSyncedTicketRecord = async ({
	cwd,
	ticketBranch,
	config,
	env,
	change,
	onProgress,
}: Params): Promise<{ record: TicketRecord; publishError?: string } | { error: string }> => {
	const pulled = await pullTicketRecord({ cwd, ticketBranch, config, env, onProgress });

	if ('error' in pulled) {
		return pulled;
	}

	const updated = await updateLocalTicketRecord({ cwd, ticketBranch, change });

	if ('error' in updated) {
		return updated;
	}

	const target = resolveTicketTrackerTarget({ config, env, ticketBranch });

	// A tracker that cannot be used at all was already answered by the pull, so
	// what is left here is a ticket with nowhere to publish to.
	if ('error' in target || 'localOnly' in target) {
		return { record: updated.record };
	}

	const stateDir = await resolveSharedStateDir({ cwd });
	const ticketFolder = getTicketFolderPath({ stateDir, ticketBranch });
	const syncState = await readTicketSyncState({ ticketFolder });
	const attached = await attachTicketRecordIfUnmoved({
		cwd,
		ticketBranch,
		target,
		expectedPublishedSha256: syncState?.recordSha256,
		onProgress,
	});

	if ('error' in attached) {
		return { record: updated.record, publishError: attached.error };
	}

	const recorded = await recordTicketSyncState({
		ticketFolder,
		recordSha256: attached.attachedSha256,
		failure: publishedButUnrecorded,
	});

	return recorded === undefined ? { record: updated.record } : { record: updated.record, publishError: recorded.error };
};
