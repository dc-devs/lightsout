import { formatPlanAddress } from '#src/common/planAddress/formatPlanAddress.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { resolveSharedStateDir } from '#src/common/workspace/resolveSharedStateDir.ts';
import type { LightsoutConfig, TicketRecord } from '#src/contracts/index.ts';
import { pathExists, planWorkspaceDir, publishPlan } from '#src/plan/index.ts';
import { publishedButUnrecorded } from '#src/ticket/common/constants/publishedButUnrecorded.ts';
import { TicketSyncKeep } from '#src/ticket/common/constants/TicketSyncKeep.ts';
import { ticketFileNames } from '#src/ticket/common/constants/ticketFileNames.ts';
import type { PublishedTicketRecord } from '#src/ticket/common/types/PublishedTicketRecord.ts';
import type { TicketTrackerTarget } from '#src/ticket/common/types/TicketTrackerTarget.ts';
import { attachTicketRecordIfUnmoved } from '#src/ticket/common/utils/attachTicketRecordIfUnmoved.ts';
import { findDivergentPlanIds } from '#src/ticket/common/utils/findDivergentPlanIds.ts';
import { getTicketFolderPath } from '#src/ticket/common/utils/getTicketFolderPath.ts';
import { readPublishedTicketRecord } from '#src/ticket/common/utils/readPublishedTicketRecord.ts';
import { readTicketSyncState } from '#src/ticket/common/utils/readTicketSyncState.ts';
import { recordTicketSyncState } from '#src/ticket/common/utils/recordTicketSyncState.ts';
import { mergeOneSidedPlans } from '#src/ticket/divergence/mergeOneSidedPlans.ts';
import { resolvePlanWorkingCheckout } from '#src/ticket/divergence/resolvePlanWorkingCheckout.ts';
import { readTicketRecord } from '#src/ticket/readTicketRecord.ts';
import { updateLocalTicketRecord } from '#src/ticket/updateLocalTicketRecord.ts';

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

interface PlanMarkers {
	/** What the kept record will say each plan's published generation is. */
	recorded: Record<string, string>;
	/** The subset this machine itself has just published, which is all the sidecar may claim. */
	published: Record<string, string>;
}

/**
 * Put this machine's copy of each divergent plan back on the ticket, so the
 * kept record's markers describe files that are really there.
 *
 * A plan this machine does not hold cannot be republished, so the kept record
 * takes the ticket's own marker for it: the ticket's files stay as they are and
 * the record describes them truthfully. The sidecar is told only about the
 * plans actually republished here, because it records what THIS machine has
 * published or restored and nothing else.
 *
 * A ticket carrying no record of its own has nothing to be behind, so no plan
 * is divergent and nothing is republished.
 */
const republishDivergentPlans = async ({
	cwd,
	ticketBranch,
	ticketFolder,
	carried,
	kept,
	config,
	env,
	onProgress,
}: {
	cwd: string;
	ticketBranch: string;
	ticketFolder: string;
	carried: TicketRecord | undefined;
	kept: TicketRecord;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}): Promise<PlanMarkers | { error: string }> => {
	const markers: PlanMarkers = { recorded: {}, published: {} };

	if (carried === undefined) {
		return markers;
	}

	const syncState = await readTicketSyncState({ ticketFolder });
	const planIds = findDivergentPlanIds({ record: carried, syncState }).filter((planId) => kept.plans.some((plan) => plan.id === planId));

	for (const planId of planIds) {
		const address = formatPlanAddress({ ticketBranch, planId });
		const { checkout } = await resolvePlanWorkingCheckout({ cwd, ticketBranch, planId });
		const held = await pathExists({ path: planWorkspaceDir({ cwd: checkout, name: address }) });
		const publishedMarker = carried.plans.find((plan) => plan.id === planId)?.publishedMarker;

		if (!held) {
			onProgress?.(`plan ${planId} has no folder on this machine, so the ticket's own copy of it is left as it is and the kept record describes that copy`);

			if (publishedMarker !== undefined) {
				markers.recorded[planId] = publishedMarker;
			}

			continue;
		}

		const report = await publishPlan({ cwd: checkout, name: address, config, env, onProgress: onProgress ?? (() => undefined), titlePrefix: planId });

		if (report.error !== undefined) {
			return { error: `plan ${planId} could not be published over the ticket's copy, so the ticket record was left alone: ${report.error}` };
		}

		if (report.markerSha256 !== undefined) {
			markers.recorded[planId] = report.markerSha256;
			markers.published[planId] = report.markerSha256;
		}
	}

	return markers;
};

/** The kept record with each plan's published marker set to what the ticket now carries for it. */
const withPlanMarkers = ({ record, markers }: { record: TicketRecord; markers: Record<string, string> }): TicketRecord => ({
	...record,
	plans: record.plans.map((plan) => (markers[plan.id] === undefined ? plan : { ...plan, publishedMarker: markers[plan.id] })),
});

interface RecordsToKeep {
	/** This machine's record, holding every plan either copy knows about. */
	kept: TicketRecord;
	/** The ticket's own copy and its normalised bytes, absent when the ticket carries none. */
	carried: PublishedTicketRecord | undefined;
}

/**
 * Read both copies and settle what the kept record will say, before anything is
 * published.
 *
 * Plans only the ticket's copy holds are carried into this machine's record, so
 * a plan added on another machine is neither lost nor has its number handed to
 * something else later.
 */
const readRecordsToKeep = async ({
	cwd,
	ticketBranch,
	target,
}: {
	cwd: string;
	ticketBranch: string;
	target: TicketTrackerTarget;
}): Promise<RecordsToKeep | { error: string }> => {
	const local = await readTicketRecord({ cwd, ticketBranch });

	if ('error' in local) {
		return local;
	}

	if (local.record === undefined) {
		return { error: `there is no ${ticketFileNames.record} for '${ticketBranch}' on this machine, so there is no local ticket record to keep` };
	}

	const published = await readPublishedTicketRecord({ target, ticketBranch });

	if ('error' in published) {
		return published;
	}

	const carried = published.published;
	const kept =
		carried === undefined
			? local.record
			: mergeOneSidedPlans({ kept: local.record, other: carried.record, keptFrom: TicketSyncKeep.Local, at: new Date().toISOString() });

	return 'error' in kept ? kept : { kept, carried };
};

/**
 * Settle a divergence this machine's way: its record is published over the
 * ticket's, and every plan whose published files this machine never saw is
 * republished from the copy here.
 *
 * The plans are republished before the record, so a record naming a marker no
 * attachment matches is never left on the ticket. The upload of the record
 * itself is still guarded: keeping the local copy overrides the published
 * version the human looked at, never one that arrived after it, so a third
 * machine publishing mid-command is reported rather than overwritten.
 */
export const keepLocalTicketRecord = async ({
	cwd,
	ticketBranch,
	config,
	env,
	target,
	onProgress,
}: Params): Promise<{ record: TicketRecord } | { error: string }> => {
	const records = await readRecordsToKeep({ cwd, ticketBranch, target });

	if ('error' in records) {
		return records;
	}

	const { kept, carried } = records;
	const stateDir = await resolveSharedStateDir({ cwd });
	const ticketFolder = getTicketFolderPath({ stateDir, ticketBranch });
	const markers = await republishDivergentPlans({
		cwd,
		ticketBranch,
		ticketFolder,
		carried: carried?.record,
		kept,
		config,
		env,
		onProgress,
	});

	if ('error' in markers) {
		return markers;
	}

	const applied = await updateLocalTicketRecord({ cwd, ticketBranch, change: () => withPlanMarkers({ record: kept, markers: markers.recorded }) });

	if ('error' in applied) {
		return applied;
	}

	const attached = await attachTicketRecordIfUnmoved({
		cwd,
		ticketBranch,
		target,
		expectedPublishedSha256: carried === undefined ? undefined : sha256({ content: carried.content }),
		onProgress,
	});

	if ('error' in attached) {
		return attached;
	}

	const recorded = await recordTicketSyncState({
		ticketFolder,
		recordSha256: attached.attachedSha256,
		planMarkers: markers.published,
		failure: publishedButUnrecorded,
		dropSurfacedCopy: true,
	});

	return recorded === undefined ? { record: applied.record } : recorded;
};
