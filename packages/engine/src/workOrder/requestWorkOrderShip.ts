import { type LightsoutConfig, WorkOrderEventKind, WorkOrderMode, type WorkOrderPlan, type WorkOrderState } from '#src/contracts/index.ts';
import { appendWorkOrderEvent } from '#src/workOrder/common/record/appendWorkOrderEvent.ts';
import { changeExistingWorkOrderState } from '#src/workOrder/common/record/changeExistingWorkOrderState.ts';
import { resolveWorkOrderPlan } from '#src/workOrder/common/record/resolveWorkOrderPlan.ts';
import type { WorkOrderStateChange } from '#src/workOrder/common/types/WorkOrderStateChange.ts';

interface Params {
	/** Any checkout of the repository: the one record this machine holds is found from it. */
	cwd: string;
	/** The work order's label, which is also the branch its plans implement on. */
	name: string;
	/** Full plan ids or bare numbers, as they were typed. */
	plans: string[];
	config: LightsoutConfig;
	/** The process environment the tracker API key is read from. */
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

/** Every token turned into the plan it names, or the first token that names nothing the request may include. */
const resolveRequestedPlans = ({ record, tokens }: { record: WorkOrderState; tokens: string[] }): WorkOrderPlan[] | { error: string } => {
	const named: WorkOrderPlan[] = [];

	for (const token of tokens) {
		const plan = resolveWorkOrderPlan({ record, token });

		if ('error' in plan) {
			return plan;
		}

		if (plan.exclusion !== undefined) {
			return {
				error: `plan ${plan.id} is excluded from work order ${record.branch} — ${plan.exclusion.reason} — so a ship request cannot name it; an exclusion is final and the plan's files stay where they are`,
			};
		}

		if (!named.some((candidate) => candidate.id === plan.id)) {
			named.push(plan);
		}
	}

	return named;
};

/** A ship request approves the ticket's whole remaining work, so a plan it leaves out has to be excluded on purpose first. */
const findUncoveredPlansRefusal = ({ record, named }: { record: WorkOrderState; named: WorkOrderPlan[] }) => {
	const included = record.plans.filter((plan) => plan.exclusion === undefined);
	const uncovered = included.filter((plan) => !named.some((candidate) => candidate.id === plan.id));

	return uncovered.length === 0
		? undefined
		: `the ship request for work order ${record.branch} does not name ${uncovered.map((plan) => plan.id).join(', ')}, and a request approves every plan the ticket still includes — name them too, or take one out of the ticket's work with \`lightsout work-order exclude-plan --name ${record.branch} --plan <id> --reason <text>\``;
};

/**
 * Record the human's explicit request to ship a multiple-plan ticket, bound to
 * the exact plans it approves.
 *
 * The request is what a multiple-plan ticket ships on: the human declares the
 * finish line and the queue carries it out once the named plans are
 * implemented. Binding it to stable ids rather than to a count is what lets the
 * check immediately before the merge tell a renamed plan from a new one.
 *
 * The stored ids are always the ticket's own included plans in number order,
 * whichever spelling was typed, so the set can be compared to the ticket's
 * plans by equality later.
 */
export const requestWorkOrderShip = ({ cwd, name, plans, config, env, onProgress }: Params): Promise<WorkOrderStateChange | { error: string }> =>
	changeExistingWorkOrderState({
		cwd,
		name,
		config,
		env,
		onProgress,
		change: (record) => {
			if (record.mode !== WorkOrderMode.MultiplePlan) {
				return {
					error: `work order ${name} is in single-plan mode, where plan 001 alone supplies the implementation and this repository's own shipping settings apply — switch with \`lightsout work-order mode --name ${name} --set multiple-plan\` before asking for a ship request`,
				};
			}

			if (plans.length === 0) {
				return { error: `a ship request names the plans it approves, and none was given — name every plan work order ${name} still includes` };
			}

			const named = resolveRequestedPlans({ record, tokens: plans });

			if ('error' in named) {
				return named;
			}

			const uncovered = findUncoveredPlansRefusal({ record, named });

			if (uncovered !== undefined) {
				return { error: uncovered };
			}

			const planIds = record.plans.filter((plan) => named.some((candidate) => candidate.id === plan.id)).map((plan) => plan.id);
			const at = new Date().toISOString();

			return appendWorkOrderEvent({
				record: { ...record, shipRequest: { planIds, requestedAt: at } },
				kind: WorkOrderEventKind.ShipRequested,
				detail: `work order ${name} is to ship once ${planIds.join(', ')} are implemented`,
				at,
			});
		},
	});
