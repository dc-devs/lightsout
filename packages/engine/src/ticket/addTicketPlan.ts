import { mkdir } from 'node:fs/promises';
import { formatPlanAddress } from '#src/common/planAddress/formatPlanAddress.ts';
import { planNumberOf } from '#src/common/planAddress/planNumberOf.ts';
import { type LightsoutConfig, PlanProgress, TicketEventKind, TicketMode, type TicketRecord } from '#src/contracts/index.ts';
import { planAttachmentManifestName, planWorkspaceDir } from '#src/plan/index.ts';
import { appendTicketEvent } from '#src/ticket/common/record/appendTicketEvent.ts';
import { buildTicketRecord } from '#src/ticket/common/record/buildTicketRecord.ts';
import { composePlanId } from '#src/ticket/common/record/composePlanId.ts';
import { recordShipRequestWithdrawal } from '#src/ticket/common/record/recordShipRequestWithdrawal.ts';
import { requireTicketRecord } from '#src/ticket/common/record/requireTicketRecord.ts';
import type { TicketRecordChange } from '#src/ticket/common/types/TicketRecordChange.ts';
import { listLegacyPlanEntries } from '#src/ticket/common/utils/listLegacyPlanEntries.ts';
import { resolveTicketTrackerTarget } from '#src/ticket/common/utils/resolveTicketTrackerTarget.ts';
import { pullTicketRecord } from '#src/ticket/pullTicketRecord.ts';
import { updateSyncedTicketRecord } from '#src/ticket/updateSyncedTicketRecord.ts';
import { getTicketAttachments } from '#src/ticketTracker/index.ts';

interface Params {
	/** Any checkout of the repository: the one record this machine holds is found from it, and the plan folder is made here. */
	cwd: string;
	/** The ticket folder's name, which is also the branch its plans implement on. */
	ticketBranch: string;
	/** The plan slug, fixed for the life of the plan: lowercase letter-and-digit words joined by single hyphens. */
	slug: string;
	/** The plan's first display title, which stays changeable. Defaults to the slug. */
	title?: string;
	config: LightsoutConfig;
	/** The process environment the tracker API key is read from. */
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

/** What the change made, so the caller can name the plan and say why an approval lapsed. */
interface PlanAddition {
	record: TicketRecord;
	planId: string;
	/** Whether adding this plan took a pending ship request off the ticket. */
	withdrew: boolean;
}

/** The highest number a ticket may ever allocate: a plan id carries exactly three digits. */
const maxPlanNumber = 999;

/** The next id this ticket has never held, or why the slug or the number cannot make one. */
const allocatePlanId = ({ record, slug }: { record: TicketRecord; slug: string }): { id: string } | { error: string } => {
	const highest = record.plans.reduce((top, plan) => Math.max(top, planNumberOf({ id: plan.id })), 0);
	const next = highest + 1;

	if (next > maxPlanNumber) {
		return {
			error: `ticket ${record.branch} already holds plan ${String(highest).padStart(3, '0')}, and a plan's number never goes above ${maxPlanNumber} because no number is ever reused`,
		};
	}

	return composePlanId({ number: next, slug });
};

/**
 * A plan published to this ticket before ticket records existed, which a
 * follow-up plan must never silently take number 001 over.
 *
 * Only asked when no record exists on this machine or on the ticket, and only
 * when a tracker is configured. A bare brainstorm generation alone is not
 * evidence of a plan: plan 001 picks that up through the brainstorm restore's
 * own fallback.
 */
const findPublishedLegacyPlanRefusal = async ({
	ticketBranch,
	config,
	env,
}: {
	ticketBranch: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
}): Promise<string | undefined> => {
	const target = resolveTicketTrackerTarget({ config, env, ticketBranch });

	if ('localOnly' in target) {
		return undefined;
	}

	if ('error' in target) {
		return target.error;
	}

	const attachments = await getTicketAttachments({ settings: target.settings, identifier: target.ticketRef });

	if ('error' in attachments) {
		return attachments.error;
	}

	return attachments.some(({ title }) => title === planAttachmentManifestName)
		? `${target.ticketRef} already carries a plan published before ticket records existed, so a new plan here would take a number that plan already holds — turn it into plan 001 first with \`lightsout ticket adopt --name ${ticketBranch} --slug <slug>\``
		: undefined;
};

/** Everything the record must say before a plan may be added to it, and the plan added once it does. */
const addPlanToRecord = ({
	current,
	ticketBranch,
	slug,
	title,
	config,
	legacyEntries,
	at,
}: {
	current: TicketRecord | undefined;
	ticketBranch: string;
	slug: string;
	title: string | undefined;
	config: LightsoutConfig;
	legacyEntries: string[];
	at: string;
}): PlanAddition | { error: string } => {
	const existing = current === undefined ? undefined : requireTicketRecord({ record: current, ticketBranch });

	if (existing !== undefined && 'error' in existing) {
		return existing;
	}

	if (legacyEntries.length > 0) {
		return {
			error:
				existing === undefined
					? `the plan folder '${ticketBranch}' still holds the files of a single-folder plan (${legacyEntries.join(', ')}) — make them plan 001 with \`lightsout ticket adopt --name ${ticketBranch} --slug <slug>\` before adding another plan`
					: `the ticket folder '${ticketBranch}' holds ${legacyEntries.join(', ')} beside its record, and a ticket's plan files live in that plan's own folder — move each of them into the plan folder it belongs to, or remove it, and run this again`,
		};
	}

	if (existing !== undefined && existing.mode === TicketMode.SinglePlan && existing.plans.some((plan) => planNumberOf({ id: plan.id }) === 1)) {
		return {
			error: `ticket ${ticketBranch} is in single-plan mode, where plan 001 alone supplies the implementation — run \`lightsout ticket mode --set multiple-plan --name ${ticketBranch}\` before adding a second plan`,
		};
	}

	const base = existing ?? buildTicketRecord({ ticketBranch, config });

	if ('error' in base) {
		return base;
	}

	const allocated = allocatePlanId({ record: base, slug });

	if ('error' in allocated) {
		return allocated;
	}

	const added = appendTicketEvent({
		record: { ...base, plans: [...base.plans, { id: allocated.id, title: title ?? slug, progress: PlanProgress.Planning, createdAt: at }] },
		kind: TicketEventKind.PlanAdded,
		detail: `plan ${allocated.id} was added to ticket ${ticketBranch}`,
		at,
	});

	return {
		record: recordShipRequestWithdrawal({
			record: added,
			detail: `plan ${allocated.id} was added, so the ship request naming ${base.shipRequest?.planIds.join(', ') ?? ''} no longer covers the ticket's work`,
			at,
		}),
		planId: allocated.id,
		withdrew: base.shipRequest !== undefined,
	};
};

/**
 * Add the next plan to a ticket, creating the ticket's record when it has none.
 *
 * The id is one above the highest number the ticket has ever held, excluded
 * plans counted, so a number is never reused and a ship request, an exclusion
 * or a published attachment can never come to mean a different plan. Adding a
 * plan to a multiple-plan ticket withdraws any pending ship request, because
 * the set of plans that request approved is no longer the ticket's whole work.
 *
 * The plan's folder is made only after the record change has gone through, so a
 * refusal leaves nothing behind for the next command to trip over.
 */
export const addTicketPlan = async ({
	cwd,
	ticketBranch,
	slug,
	title,
	config,
	env,
	onProgress,
}: Params): Promise<(TicketRecordChange & { address: string }) | { error: string }> => {
	const pulled = await pullTicketRecord({ cwd, ticketBranch, config, env, onProgress });

	if ('error' in pulled) {
		return pulled;
	}

	const published = pulled.record === undefined ? await findPublishedLegacyPlanRefusal({ ticketBranch, config, env }) : undefined;

	if (published !== undefined) {
		return { error: published };
	}

	// Read before the change, because the store's change callback is pure: a
	// listing taken inside it could not reach the disk at all.
	const legacyEntries = await listLegacyPlanEntries({ plansFolder: await planWorkspaceDir({ cwd, name: ticketBranch }) });
	let addition: PlanAddition | undefined;
	const updated = await updateSyncedTicketRecord({
		cwd,
		ticketBranch,
		config,
		env,
		onProgress,
		change: (current) => {
			const added = addPlanToRecord({ current, ticketBranch, slug, title, config, legacyEntries, at: new Date().toISOString() });

			if ('error' in added) {
				return added;
			}

			addition = added;

			return added.record;
		},
	});

	if ('error' in updated) {
		return updated;
	}

	if (addition === undefined) {
		return { error: `the plan was not added to ticket ${ticketBranch}: the store reported no change` };
	}

	const address = formatPlanAddress({ ticketBranch, planId: addition.planId });

	await mkdir(await planWorkspaceDir({ cwd, name: address }), { recursive: true });

	return {
		address,
		record: updated.record,
		notice: addition.withdrew
			? `the pending ship request was withdrawn because plan ${addition.planId} was added — ask again with \`lightsout ticket request-ship --name ${ticketBranch}\` once the ticket's work is settled`
			: undefined,
		publishError: updated.publishError,
	};
};
