import { rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { scopeAttachments } from '#src/common/attachmentManifest/scopeAttachments.ts';
import { formatPlanAddress } from '#src/common/planAddress/formatPlanAddress.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { ticketFolderDir } from '#src/common/workspace/ticketFolderDir.ts';
import type { LightsoutConfig, TicketRecord } from '#src/contracts/index.ts';
import { pathExists, planAttachmentManifestName, planWorkspaceDir } from '#src/plan/index.ts';
import { TicketSyncKeep } from '#src/ticket/common/constants/TicketSyncKeep.ts';
import { ticketFileNames } from '#src/ticket/common/constants/ticketFileNames.ts';
import type { TicketTrackerTarget } from '#src/ticket/common/types/TicketTrackerTarget.ts';
import { findDivergentPlanIds } from '#src/ticket/common/utils/findDivergentPlanIds.ts';
import { readPublishedTicketRecord } from '#src/ticket/common/utils/readPublishedTicketRecord.ts';
import { readTicketSyncState } from '#src/ticket/common/utils/readTicketSyncState.ts';
import { serializeTicketRecord } from '#src/ticket/common/utils/serializeTicketRecord.ts';
import { updateTicketSyncState } from '#src/ticket/common/utils/updateTicketSyncState.ts';
import { withTicketRecordLock } from '#src/ticket/common/utils/withTicketRecordLock.ts';
import { writeTicketFolderFile } from '#src/ticket/common/utils/writeTicketFolderFile.ts';
import { mergeOneSidedPlans } from '#src/ticket/divergence/mergeOneSidedPlans.ts';
import { resolvePlanWorkingCheckout } from '#src/ticket/divergence/resolvePlanWorkingCheckout.ts';
import { readTicketRecord } from '#src/ticket/readTicketRecord.ts';
import { restoreTicketPlan } from '#src/ticket/restoreTicketPlan.ts';
import { getTicketAttachments, readTicketAsset } from '#src/ticketTracker/index.ts';

interface Params {
	/** Any checkout of the repository the command was launched from. */
	cwd: string;
	ticketBranch: string;
	config: LightsoutConfig;
	/** The process environment the tracker API key is read from. */
	env: NodeJS.ProcessEnv;
	target: TicketTrackerTarget;
	onProgress?: (message: string) => void;
}

/** The SHA-256 of the marker the ticket actually carries for one plan, so the record's claim can be checked before anything moves. */
const readPublishedPlanMarker = async ({
	planId,
	target,
}: {
	planId: string;
	target: TicketTrackerTarget;
}): Promise<{ marker: string | undefined } | { error: string }> => {
	const { settings, ticketRef } = target;
	const attachments = await getTicketAttachments({ settings, identifier: ticketRef });

	if ('error' in attachments) {
		return { error: `the plan generation for ${planId} on ${ticketRef} could not be read: ${attachments.error}` };
	}

	const markers = scopeAttachments({ attachments, prefix: planId }).filter(({ title }) => title === planAttachmentManifestName);
	const marker = markers.length === 1 ? markers[0] : undefined;

	if (marker === undefined) {
		return { marker: undefined };
	}

	const text = await readTicketAsset({ settings, url: marker.url });

	return typeof text === 'string'
		? { marker: sha256({ content: text }) }
		: { error: `the plan generation for ${planId} on ${ticketRef} could not be read: ${text.error}` };
};

/** Rename one checkout's copy of a plan folder to the next free `.local-<n>` beside it. Nothing is ever deleted. */
const setPlanFolderAside = async ({
	checkout,
	ticketBranch,
	planId,
	onProgress,
}: {
	checkout: string;
	ticketBranch: string;
	planId: string;
	onProgress?: (message: string) => void;
}) => {
	const name = formatPlanAddress({ ticketBranch, planId });
	const dir = await planWorkspaceDir({ cwd: checkout, name });

	if (!(await pathExists({ path: dir }))) {
		return undefined;
	}

	let attempt = 1;
	let aside = `${dir}.local-${attempt}`;

	while (await pathExists({ path: aside })) {
		attempt += 1;
		aside = `${dir}.local-${attempt}`;
	}

	try {
		await rename(dir, aside);
	} catch (error) {
		return { error: `the local copy of plan ${planId} at ${dir} could not be moved aside: ${messageOf({ error })}` };
	}

	onProgress?.(`moved ${dir} aside to ${aside} — nothing was deleted`);

	return undefined;
};

/** Set every local copy of one plan aside, then write the ticket's own copy into the checkout the plan is worked on in. */
const takePublishedPlan = async ({
	cwd,
	ticketBranch,
	planId,
	record,
	config,
	env,
	target,
	onProgress,
}: {
	cwd: string;
	ticketBranch: string;
	planId: string;
	record: TicketRecord;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	target: TicketTrackerTarget;
	onProgress?: (message: string) => void;
}) => {
	const published = await readPublishedPlanMarker({ planId, target });

	if ('error' in published) {
		return published;
	}

	const claimed = record.plans.find((plan) => plan.id === planId)?.publishedMarker;

	if (published.marker === undefined || published.marker !== claimed) {
		return {
			error: `${target.ticketRef}'s plan files and its ticket record disagree about plan ${planId}: the record names a commit marker the ticket does not carry, so nothing was moved — publish that plan again from the machine that holds it, or run \`lightsout ticket sync --name ${ticketBranch} --keep local\``,
		};
	}

	const { checkout, otherCopies } = await resolvePlanWorkingCheckout({ cwd, ticketBranch, planId });

	for (const copy of [checkout, ...otherCopies]) {
		const moved = await setPlanFolderAside({ checkout: copy, ticketBranch, planId, onProgress });

		if (moved !== undefined) {
			return moved;
		}
	}

	const restored = await restoreTicketPlan({ cwd: checkout, address: formatPlanAddress({ ticketBranch, planId }), config, env, recordCwd: cwd, onProgress });

	if ('error' in restored) {
		return restored;
	}

	return restored.restored.length === 0
		? {
				error: `${target.ticketRef} carries no plan generation for ${planId}, so the published copy of that plan could not be restored — the local copy was moved aside and nothing was deleted`,
			}
		: undefined;
};

/** Write the ticket's record over this machine's, remember its bytes, and drop the surfaced copy the divergence left behind. */
const writeKeptRecord = async ({ ticketFolder, record }: { ticketFolder: string; record: TicketRecord }) => {
	const content = serializeTicketRecord({ record });

	await writeTicketFolderFile({ path: join(ticketFolder, ticketFileNames.record), content });
	await updateTicketSyncState({ ticketFolder, recordSha256: sha256({ content }) });
	await rm(join(ticketFolder, ticketFileNames.published), { force: true });
};

/**
 * Settle a divergence the ticket's way: its record becomes this machine's, and
 * every plan whose files this machine never published or restored is restored
 * from the ticket over a copy set aside rather than deleted.
 *
 * The record is written first because it is the index every later step reads,
 * and each plan's own marker is checked against it before anything is moved: a
 * ticket whose plan files and record disagree is a repair job, not a restore,
 * and moving a folder aside to make room for a restore that cannot succeed
 * would be the one way this command could lose work.
 *
 * Plans only this machine's copy holds are carried into the kept record, so a
 * plan added here while the ticket moved is neither lost nor has its number
 * handed to something else later.
 */
export const keepPublishedTicketRecord = async ({
	cwd,
	ticketBranch,
	config,
	env,
	target,
	onProgress,
}: Params): Promise<{ record: TicketRecord } | { error: string }> => {
	const published = await readPublishedTicketRecord({ target, ticketBranch });

	if ('error' in published) {
		return published;
	}

	if (published.published === undefined) {
		return { error: `${target.ticketRef} carries no ${ticketFileNames.record}, so there is no published ticket record to keep` };
	}

	const local = await readTicketRecord({ cwd, ticketBranch });

	if ('error' in local) {
		return local;
	}

	const merged =
		local.record === undefined
			? published.published.record
			: mergeOneSidedPlans({ kept: published.published.record, other: local.record, keptFrom: TicketSyncKeep.Published, at: new Date().toISOString() });

	if ('error' in merged) {
		return merged;
	}

	const ticketFolder = await ticketFolderDir({ cwd, ticketBranch });
	const written = await withTicketRecordLock({
		ticketFolder,
		run: async (): Promise<{ error: string } | undefined> => {
			try {
				await writeKeptRecord({ ticketFolder, record: merged });

				return undefined;
			} catch (error) {
				return { error: `the published ticket record could not be written into ${ticketFolder}: ${messageOf({ error })}` };
			}
		},
	});

	if (written !== undefined) {
		return written;
	}

	const syncState = await readTicketSyncState({ ticketFolder });

	for (const planId of findDivergentPlanIds({ record: merged, syncState })) {
		const taken = await takePublishedPlan({ cwd, ticketBranch, planId, record: merged, config, env, target, onProgress });

		if (taken !== undefined) {
			return taken;
		}
	}

	return { record: merged };
};
