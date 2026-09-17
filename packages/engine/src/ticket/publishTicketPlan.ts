import { parsePlanAddress } from '#src/common/planAddress/parsePlanAddress.ts';
import { resolveSharedStateDir } from '#src/common/workspace/resolveSharedStateDir.ts';
import { type LightsoutConfig, PlanProgress, type TicketRecord } from '#src/contracts/index.ts';
import { publishPlan } from '#src/plan/index.ts';
import { ticketFileNames } from '#src/ticket/common/constants/ticketFileNames.ts';
import type { TicketTrackerTarget } from '#src/ticket/common/types/TicketTrackerTarget.ts';
import { findPlanPublishRefusal } from '#src/ticket/common/utils/findPlanPublishRefusal.ts';
import { getTicketFolderPath } from '#src/ticket/common/utils/getTicketFolderPath.ts';
import { publishBrainstormWhenNotesChanged } from '#src/ticket/common/utils/publishBrainstormWhenNotesChanged.ts';
import { readTicketSyncState } from '#src/ticket/common/utils/readTicketSyncState.ts';
import { recordTicketSyncState } from '#src/ticket/common/utils/recordTicketSyncState.ts';
import { resolveTicketTrackerTarget } from '#src/ticket/common/utils/resolveTicketTrackerTarget.ts';
import { pullTicketRecord } from '#src/ticket/pullTicketRecord.ts';
import { updateSyncedTicketRecord } from '#src/ticket/updateSyncedTicketRecord.ts';

interface Params {
	cwd: string;
	/** The plan's address, `<ticket-branch>/<plan-id>`. */
	address: string;
	config: LightsoutConfig;
	/** The process environment the tracker API key is read from. */
	env: NodeJS.ProcessEnv;
	onProgress: (message: string) => void;
}

interface TicketPlanPublishReport {
	/** The ticket the files landed on, e.g. 'LO-140'. Absent when nothing was published. */
	ticketRef?: string;
	/** Every attachment title this run wrote, in attach order, ending with the ticket record. */
	published: string[];
	/** Titles under this plan's own prefix from an earlier publish that this run did not write. Reported, never deleted. */
	stale: string[];
	/** Set when the publish stopped — the one sentence saying why. */
	error?: string;
	/** Set when the plan's files landed but `ticket.json` does not say so. */
	recordError?: string;
}

/** The change the record takes once the plan's files have landed: the new marker, and `planning` becoming `ready`. */
const recordPublishedPlan =
	({ planId, markerSha256, ticketBranch }: { planId: string; markerSha256: string; ticketBranch: string }) =>
	(current: TicketRecord | undefined): TicketRecord | { error: string } => {
		const plan = current?.plans.find((entry) => entry.id === planId);

		if (current === undefined || plan === undefined) {
			return { error: `the ticket record for '${ticketBranch}' no longer holds plan ${planId}, so the publish could not be recorded` };
		}

		return {
			...current,
			plans: current.plans.map((entry) =>
				entry.id === planId
					? { ...entry, publishedMarker: markerSha256, progress: entry.progress === PlanProgress.Planning ? PlanProgress.Ready : entry.progress }
					: entry,
			),
		};
	};

/** Remember the generation this machine has just published, only once the record itself carries it. */
const recordMarkerLocally = async ({
	cwd,
	ticketBranch,
	planId,
	markerSha256,
}: {
	cwd: string;
	ticketBranch: string;
	planId: string;
	markerSha256: string;
}) => {
	const stateDir = await resolveSharedStateDir({ cwd });

	return recordTicketSyncState({
		ticketFolder: getTicketFolderPath({ stateDir, ticketBranch }),
		planMarkers: { [planId]: markerSha256 },
		failure: `plan ${planId} was published, but this machine could not record which generation it sent`,
	});
};

/**
 * Put the new generation in the ticket record and in this machine's sidecar,
 * and say whether `ticket.json` itself landed.
 *
 * The sidecar is written only once the record carries the marker, so an
 * interrupted publish leaves both naming the old generation — which is a plan
 * that can simply be published again, rather than one that looks divergent.
 */
const recordPlanPublish = async ({
	cwd,
	ticketBranch,
	planId,
	markerSha256,
	config,
	env,
	onProgress,
}: {
	cwd: string;
	ticketBranch: string;
	planId: string;
	markerSha256: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	onProgress: (message: string) => void;
}): Promise<{ published: string[]; recordError?: string }> => {
	const recorded = await updateSyncedTicketRecord({
		cwd,
		ticketBranch,
		config,
		env,
		change: recordPublishedPlan({ planId, markerSha256, ticketBranch }),
		onProgress,
	});

	if ('error' in recorded) {
		return { published: [], recordError: recorded.error };
	}

	if (recorded.publishError !== undefined) {
		return { published: [], recordError: recorded.publishError };
	}

	const remembered = await recordMarkerLocally({ cwd, ticketBranch, planId, markerSha256 });
	const landed = [ticketFileNames.record];

	return remembered === undefined ? { published: landed } : { published: landed, recordError: remembered.error };
};

/** The brainstorm generation, the plan generation, and the record — in that order, keeping every title that did land. */
const publishGenerations = async ({
	cwd,
	address,
	planId,
	ticketBranch,
	target,
	config,
	env,
	onProgress,
}: {
	cwd: string;
	address: string;
	planId: string;
	ticketBranch: string;
	target: TicketTrackerTarget;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	onProgress: (message: string) => void;
}): Promise<TicketPlanPublishReport> => {
	const report: TicketPlanPublishReport = { ticketRef: target.ticketRef, published: [], stale: [] };
	const brainstorm = await publishBrainstormWhenNotesChanged({ cwd, address, planId, target, config, env, onProgress });

	if ('error' in brainstorm) {
		report.error = brainstorm.error;
	} else {
		report.published.push(...brainstorm.published);

		const plan = await publishPlan({ cwd, name: address, config, env, onProgress, titlePrefix: planId });

		report.published.push(...plan.published);
		report.stale = plan.stale;

		if (plan.error !== undefined || plan.markerSha256 === undefined) {
			report.error = plan.error ?? `plan ${planId} was published without a commit marker, so the ticket record cannot name the generation that landed`;
		} else {
			const recorded = await recordPlanPublish({ cwd, ticketBranch, planId, markerSha256: plan.markerSha256, config, env, onProgress });

			report.published.push(...recorded.published);

			if (recorded.recordError !== undefined) {
				report.recordError = recorded.recordError;
			}
		}
	}

	return report;
};

/**
 * Publish one plan of a ticket: its brainstorm generation when the notes have
 * moved, then its own files under its plan id, then the ticket record that says
 * which generation of that plan the ticket now carries.
 *
 * The order is what makes the ticket readable at every point in between. The
 * notes go first because the plan generation no longer carries them; the record
 * goes last because it names the marker the plan generation ends with, and a
 * record naming a marker no attachment matches would look like a divergence to
 * every other machine.
 *
 * The sidecar is written only after the record itself carries the new marker,
 * so an interrupted publish leaves the plan publishable again rather than
 * divergent: both the record and the sidecar still name the old generation, and
 * running `lightsout plan publish` a second time finishes the job.
 */
export const publishTicketPlan = async ({ cwd, address, config, env, onProgress }: Params): Promise<TicketPlanPublishReport> => {
	const parsed = parsePlanAddress({ name: address });

	if (parsed === undefined) {
		return { published: [], stale: [], error: `'${address}' is not a plan address — a plan of a ticket is named as '<ticket-branch>/<plan-id>'` };
	}

	const { ticketBranch, planId } = parsed;
	const target = resolveTicketTrackerTarget({ config, env, ticketBranch });

	if ('error' in target) {
		return { published: [], stale: [], error: target.error };
	}

	if ('localOnly' in target) {
		return { published: [], stale: [], error: `plan ${planId} cannot be published: ${target.localOnly}` };
	}

	const pulled = await pullTicketRecord({ cwd, ticketBranch, config, env, onProgress });

	if ('error' in pulled) {
		return { ticketRef: target.ticketRef, published: [], stale: [], error: pulled.error };
	}

	const stateDir = await resolveSharedStateDir({ cwd });
	const syncState = await readTicketSyncState({ ticketFolder: getTicketFolderPath({ stateDir, ticketBranch }) });
	const refusal = await findPlanPublishRefusal({ cwd, address, planId, ticketBranch, record: pulled.record, syncState });

	if (refusal !== undefined) {
		return { ticketRef: target.ticketRef, published: [], stale: [], error: refusal };
	}

	return publishGenerations({ cwd, address, planId, ticketBranch, target, config, env, onProgress });
};
