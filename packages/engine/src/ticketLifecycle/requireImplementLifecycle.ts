import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { readBranchTicketRef } from '#src/ship/index.ts';
import { TrackerStatusRole } from '#src/ticketLifecycle/common/constants/TrackerStatusRole.ts';
import type { LifecycleSettings } from '#src/ticketLifecycle/common/types/LifecycleSettings.ts';
import { resolveLifecycleSettings } from '#src/ticketLifecycle/resolveLifecycleSettings.ts';
import { updateTicketLifecycle } from '#src/ticketLifecycle/updateTicketLifecycle.ts';
import { getTicketsByIdentifiers, resolveTrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	/** The checkout source work is about to begin in. */
	cwd: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	/** The reference `--ref` carried, when the command takes one. Absent means the branch is read instead. */
	ticketRef?: string;
	onProgress?: (message: string) => void;
}

/**
 * Which Planning Status the required pre-implementation write records.
 *
 * The two terminal shaping states are preserved, because the case that matters
 * is a human `planning-not-needed` classification that must never be rewritten
 * as shaped work. Everything else — `planning-ready-auto-plan`, either
 * `planning-needs-*` value, no label at all, or more than one — becomes
 * `planning-complete`: a queued auto-plan ticket is still
 * `planning-ready-auto-plan` when its nested implementation starts, and it must
 * not enter In Progress claiming shaping is still owed.
 */
const toPreImplementationPlanningStatus = ({ labels, lifecycle }: { labels: string[]; lifecycle: LifecycleSettings }) => {
	const byLabel = new Map(Object.values(PlanningStatus).map((status) => [lifecycle.planningStatusLabels[status], status]));
	const carried = labels.flatMap((label) => {
		const status = byLabel.get(label);

		return status === undefined ? [] : [status];
	});
	const only = carried.length === 1 ? carried[0] : undefined;

	return only === PlanningStatus.Complete || only === PlanningStatus.NotNeeded ? only : PlanningStatus.Complete;
};

/**
 * The required pre-source lifecycle write, expressed as a command-edge guard.
 *
 * A markdown instruction cannot make a write required, so the engine performs
 * it: the ticket says what preparation it owes and that implementation has
 * begun *before* an agent touches any source, and a write that cannot be made
 * stops the run rather than letting two entry points disagree about who owns
 * the branch.
 *
 * A repository with no tracker, and a branch carrying no ticket the repo's own
 * `ship.ticket-pattern` matches, both proceed untouched — there is nothing to
 * synchronize and no ticket to refuse on behalf of.
 *
 * A ticket already at the configured done status keeps that status. Re-running
 * implement on a shipped branch is ordinary — a fix-up after a merge — and
 * moving it back to In Progress would make merged work look unshipped for as
 * long as nobody noticed. The planning status is still written and the run
 * still proceeds: source work is genuinely happening, so this is not a refusal.
 *
 * @returns undefined when the run may start, or the one sentence saying why it may not
 */
export const requireImplementLifecycle = async ({ cwd, config, env, ticketRef, onProgress }: Params): Promise<string | undefined> => {
	if (config['ticket-tracker'] === undefined) {
		return undefined;
	}

	// The ticket this run is about: the reference the caller was given, or the one
	// the branch carries.
	const reference = ticketRef ?? (await readBranchTicketRef({ config, cwd }));

	if (reference === undefined) {
		return undefined;
	}

	const trackerSettings = resolveTrackerSettings({ config, env });

	if ('error' in trackerSettings) {
		return trackerSettings.error;
	}

	const lifecycle = resolveLifecycleSettings({ config });

	if ('error' in lifecycle) {
		return lifecycle.error;
	}

	const found = await getTicketsByIdentifiers({ settings: trackerSettings, identifiers: [reference] });

	if ('error' in found) {
		return found.error;
	}

	const ticket = found[0];

	if (ticket === undefined) {
		return `no ticket ${reference} was found on the tracker, and \`lightsout implement\` records In Progress before it changes any source`;
	}

	const shipped = ticket.status === lifecycle.statusNames[TrackerStatusRole.Done];
	const planningStatus = toPreImplementationPlanningStatus({ labels: ticket.labels, lifecycle });
	const inProgressStatus = lifecycle.statusNames[TrackerStatusRole.InProgress];
	const failure = await updateTicketLifecycle({
		lifecycle,
		trackerSettings,
		ticketId: ticket.id,
		planningStatus,
		trackerStatus: shipped ? undefined : TrackerStatusRole.InProgress,
		currentStatus: ticket.status,
	});

	if (failure !== undefined) {
		return `${reference} could not be moved to '${inProgressStatus}' with planning status '${lifecycle.planningStatusLabels[planningStatus]}': ${failure.error} — implement records the ticket's state before it changes any source, so the run stops here`;
	}

	onProgress?.(
		shipped
			? `${reference} · recorded '${lifecycle.planningStatusLabels[planningStatus]}' and left it at '${ticket.status}', because a shipped ticket is not moved back to '${inProgressStatus}'`
			: `${reference} · recorded '${lifecycle.planningStatusLabels[planningStatus]}' and moved to '${inProgressStatus}'`,
	);

	return undefined;
};
