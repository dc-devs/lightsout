import { formatPlanAddress } from '#src/common/planAddress/formatPlanAddress.ts';
import { planNumberOf } from '#src/common/planAddress/planNumberOf.ts';
import { type LightsoutConfig, PlanProgress, TicketEventKind, TicketMode, type TicketRecord } from '#src/contracts/index.ts';
import { planWorkspaceDir } from '#src/plan/index.ts';
import { fillPlanFolder } from '#src/ticket/common/planSource/fillPlanFolder.ts';
import { resolvePlanSourceFolder } from '#src/ticket/common/planSource/resolvePlanSourceFolder.ts';
import { appendTicketEvent } from '#src/ticket/common/record/appendTicketEvent.ts';
import { buildTicketRecord } from '#src/ticket/common/record/buildTicketRecord.ts';
import { composePlanId } from '#src/ticket/common/record/composePlanId.ts';
import { recordShipRequestWithdrawal } from '#src/ticket/common/record/recordShipRequestWithdrawal.ts';
import { requireTicketRecord } from '#src/ticket/common/record/requireTicketRecord.ts';
import type { PlanSourceFolder } from '#src/ticket/common/types/PlanSourceFolder.ts';
import type { TicketRecordChange } from '#src/ticket/common/types/TicketRecordChange.ts';
import { listLoosePlanEntries } from '#src/ticket/common/utils/listLoosePlanEntries.ts';
import { updateSyncedTicketRecord } from '#src/ticket/updateSyncedTicketRecord.ts';

interface Params {
	/** Any checkout of the repository: the one record this machine holds is found from it, and the plan folder is made here. */
	cwd: string;
	/** The ticket folder's name, which is also the branch its plans implement on. */
	ticketBranch: string;
	/** The plan slug, fixed for the life of the plan: lowercase letter-and-digit words joined by single hyphens. */
	slug: string;
	/** The plan's first display title, which stays changeable. Defaults to the slug. */
	title?: string;
	/** The source folder's bare name under the plans directory, whose loose files become this plan. Absent creates the plan empty. */
	from?: string;
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

/** Everything the record must say before a plan may be added to it, and the plan added once it does. */
const addPlanToRecord = ({
	current,
	ticketBranch,
	slug,
	title,
	from,
	progress,
	config,
	looseEntries,
	at,
}: {
	current: TicketRecord | undefined;
	ticketBranch: string;
	slug: string;
	title: string | undefined;
	from: string | undefined;
	progress: PlanProgress;
	config: LightsoutConfig;
	looseEntries: string[];
	at: string;
}): PlanAddition | { error: string } => {
	const existing = current === undefined ? undefined : requireTicketRecord({ record: current, ticketBranch });

	if (existing !== undefined && 'error' in existing) {
		return existing;
	}

	if (looseEntries.length > 0) {
		return {
			error:
				existing === undefined
					? `the plan folder '${ticketBranch}' still holds loose files (${looseEntries.join(', ')}) — make them this ticket's next plan with \`lightsout work-order add-plan --name ${ticketBranch} --slug <slug> --from ${ticketBranch}\`, or take them out of the folder first`
					: `the ticket folder '${ticketBranch}' holds ${looseEntries.join(', ')} beside its record, and a ticket's plan files live in that plan's own folder — move each of them into the plan folder it belongs to, or remove it, and run this again`,
		};
	}

	if (existing !== undefined && existing.mode === TicketMode.SinglePlan && existing.plans.some((plan) => planNumberOf({ id: plan.id }) === 1)) {
		return {
			error: `ticket ${ticketBranch} is in single-plan mode, where plan 001 alone supplies the implementation — run \`lightsout work-order mode --set multiple-plan --name ${ticketBranch}\` before adding a second plan`,
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

	const outOf = from === undefined ? '' : ` out of the loose files of '${from}'`;
	const added = appendTicketEvent({
		record: { ...base, plans: [...base.plans, { id: allocated.id, title: title ?? slug, progress, createdAt: at }] },
		kind: from === undefined ? TicketEventKind.PlanAdded : TicketEventKind.PlanAdopted,
		detail: `plan ${allocated.id} was added to ticket ${ticketBranch}${outOf}`,
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
 * Add the next plan to a ticket, creating the ticket's record when it has none,
 * and making that plan out of a source folder's loose files when `--from` names
 * one.
 *
 * The id is one above the highest number the ticket has ever held, excluded
 * plans counted, so a number is never reused and a ship request, an exclusion
 * or a published attachment can never come to mean a different plan. Adding a
 * plan to a multiple-plan ticket withdraws any pending ship request, because
 * the set of plans that request approved is no longer the ticket's whole work.
 *
 * The record goes first for both forms: the id is allocated under the lock that
 * owns it, and only then is the plan's folder made and the source's files moved
 * into it. A refusal therefore leaves nothing behind for the next command to
 * trip over, and a move that fails is put back and reported as a sentence naming
 * where the files still are — the plan stands, because by then it already does.
 */
export const addTicketPlan = async ({
	cwd,
	ticketBranch,
	slug,
	title,
	from,
	config,
	env,
	onProgress,
}: Params): Promise<(TicketRecordChange & { address: string }) | { error: string }> => {
	const resolved = from === undefined ? undefined : await resolvePlanSourceFolder({ cwd, from });

	if (resolved !== undefined && 'error' in resolved) {
		return resolved;
	}

	const source: PlanSourceFolder | undefined = resolved;
	// Read before the change, because the store's change callback is pure: a
	// listing taken inside it could not reach the disk at all. A `--from` naming
	// this ticket's own folder makes those loose files the source rather than an
	// obstruction, so there is nothing to refuse.
	const looseEntries = from === ticketBranch ? [] : await listLoosePlanEntries({ plansFolder: await planWorkspaceDir({ cwd, name: ticketBranch }) });
	let addition: PlanAddition | undefined;
	const updated = await updateSyncedTicketRecord({
		cwd,
		ticketBranch,
		config,
		env,
		onProgress,
		change: (current) => {
			const added = addPlanToRecord({
				current,
				ticketBranch,
				slug,
				title,
				from,
				progress: source?.progress ?? PlanProgress.Planning,
				config,
				looseEntries,
				at: new Date().toISOString(),
			});

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
	const sentences = [
		...(addition.withdrew
			? [
					`the pending ship request was withdrawn because plan ${addition.planId} was added — ask again with \`lightsout work-order request-ship --name ${ticketBranch}\` once the ticket's work is settled`,
				]
			: []),
		...(await fillPlanFolder({ cwd, address, planId: addition.planId, source, retire: from !== ticketBranch })),
	];

	return {
		address,
		record: updated.record,
		notice: sentences.length === 0 ? undefined : sentences.join(' '),
		publishError: updated.publishError,
	};
};
