import { formatPlanAddress } from '#src/common/planAddress/formatPlanAddress.ts';
import { toBranchSlug } from '#src/common/utils/toBranchSlug.ts';
import type { LightsoutConfig, WorkOrderState } from '#src/contracts/index.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { addWorkOrderPlan, findNextPlanToPlan, pullWorkOrderState } from '#src/workOrder/index.ts';

interface Params {
	/** The work order's worktree, where a first plan's folder is created. */
	cwd: string;
	/** The work order's label — the folder its record is keyed by, and the first segment of every address built here. */
	workOrderName: string;
	ticket: TicketSummary;
	config: LightsoutConfig;
	/** The process environment the tracker credentials are read from. */
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

/**
 * A first plan's slug, cut from the ticket title: the first three words of the
 * one slugger the repository has, so a plan's folder never drifts from how a
 * branch is named.
 *
 * `toBranchSlug` already caps its answer at 40 characters of lowercase letters,
 * digits and single hyphens, so three of its words always satisfy the plan-id
 * slug rule. A title with nothing sluggable in it becomes the word plan, because
 * an empty slug is not a plan id.
 */
const toFirstPlanSlug = ({ title }: { title: string }) => {
	const words = toBranchSlug({ text: title }).split('-').filter(Boolean).slice(0, 3);

	return words.length === 0 ? 'plan' : words.join('-');
};

/** Plan 001 added to a record that holds none, and the address the session is then handed. */
const addFirstPlan = async ({ cwd, workOrderName, ticket, config, env, onProgress }: Params) => {
	const added = await addWorkOrderPlan({
		cwd,
		name: workOrderName,
		slug: toFirstPlanSlug({ title: ticket.title }),
		title: ticket.title,
		config,
		env,
		onProgress,
	});

	if ('error' in added) {
		return added;
	}

	// A withdrawn ship request, and a local change the tracker did not take,
	// are both things the drain's reader should see rather than only the
	// command that changed the record.
	for (const message of [added.notice, added.publishError].filter((entry) => entry !== undefined)) {
		onProgress?.(message);
	}

	return { record: added.record, address: added.address };
};

/**
 * Which plan the queue's auto-plan session works on, decided by the engine
 * before the session starts.
 *
 * The session never derives a name: it is handed a plan address built from the
 * work order's LABEL — a prefixed branch would yield an address
 * `parsePlanAddress` rejects outright — and told to plan exactly that folder.
 *
 * A record that holds no plans at all, which is the state every work order
 * `lightsout work-order new` writes is in, gets plan 001 added to it; a record
 * that already holds plans gets the lowest one still being planned, so planning
 * follows the same lowest-first order building does. A record with nothing
 * waiting to be planned answers no address at all, and the worker then spends no
 * session on it.
 *
 * A work order with no record AT ALL is a refusal rather than something to
 * create: `lightsout work-order new` is the one writer of a work order's name.
 *
 * @returns the record and the plan address, the record alone when nothing is waiting to be planned, or the refusal to pass along
 */
export const chooseAutoPlanTarget = async (params: Params): Promise<{ record: WorkOrderState; address?: string } | { error: string }> => {
	const { cwd, workOrderName, config, env, onProgress } = params;
	const pulled = await pullWorkOrderState({ cwd, name: workOrderName, config, env, onProgress });

	if ('error' in pulled) {
		return pulled;
	}

	if (pulled.record === undefined) {
		return {
			error: `no work order is named ${workOrderName}, so there is no record to plan against — create one with \`lightsout work-order new --ticket <ref>\``,
		};
	}

	const { record } = pulled;

	if (record.plans.length === 0) {
		return addFirstPlan(params);
	}

	const waiting = findNextPlanToPlan({ record });

	return waiting === undefined ? { record } : { record, address: formatPlanAddress({ workOrderName, planId: waiting.id }) };
};
