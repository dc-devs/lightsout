import { type LightsoutConfig, TicketEventKind, TicketMode, type TicketPlan, type TicketRecord } from '#src/contracts/index.ts';
import { appendTicketEvent } from '#src/ticket/common/record/appendTicketEvent.ts';
import { changeExistingTicketRecord } from '#src/ticket/common/record/changeExistingTicketRecord.ts';
import { resolveTicketPlan } from '#src/ticket/common/record/resolveTicketPlan.ts';
import type { TicketRecordChange } from '#src/ticket/common/types/TicketRecordChange.ts';

interface Params {
	/** Any checkout of the repository: the one record this machine holds is found from it. */
	cwd: string;
	/** The ticket folder's name, which is also the branch its plans implement on. */
	ticketBranch: string;
	/** Full plan ids or bare numbers, as they were typed. */
	plans: string[];
	config: LightsoutConfig;
	/** The process environment the tracker API key is read from. */
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

/** Every token turned into the plan it names, or the first token that names nothing the request may include. */
const resolveRequestedPlans = ({ record, tokens }: { record: TicketRecord; tokens: string[] }): TicketPlan[] | { error: string } => {
	const named: TicketPlan[] = [];

	for (const token of tokens) {
		const plan = resolveTicketPlan({ record, token });

		if ('error' in plan) {
			return plan;
		}

		if (plan.exclusion !== undefined) {
			return {
				error: `plan ${plan.id} is excluded from ticket ${record.branch} — ${plan.exclusion.reason} — so a ship request cannot name it; an exclusion is final and the plan's files stay where they are`,
			};
		}

		if (!named.some((candidate) => candidate.id === plan.id)) {
			named.push(plan);
		}
	}

	return named;
};

/** A ship request approves the ticket's whole remaining work, so a plan it leaves out has to be excluded on purpose first. */
const findUncoveredPlansRefusal = ({ record, named }: { record: TicketRecord; named: TicketPlan[] }) => {
	const included = record.plans.filter((plan) => plan.exclusion === undefined);
	const uncovered = included.filter((plan) => !named.some((candidate) => candidate.id === plan.id));

	return uncovered.length === 0
		? undefined
		: `the ship request for ticket ${record.branch} does not name ${uncovered.map((plan) => plan.id).join(', ')}, and a request approves every plan the ticket still includes — name them too, or take one out of the ticket's work with \`lightsout ticket exclude-plan --name ${record.branch} --plan <id> --reason <text>\``;
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
export const requestTicketShip = ({ cwd, ticketBranch, plans, config, env, onProgress }: Params): Promise<TicketRecordChange | { error: string }> =>
	changeExistingTicketRecord({
		cwd,
		ticketBranch,
		config,
		env,
		onProgress,
		change: (record) => {
			if (record.mode !== TicketMode.MultiplePlan) {
				return {
					error: `ticket ${ticketBranch} is in single-plan mode, where plan 001 alone supplies the implementation and this repository's own shipping settings apply — switch with \`lightsout ticket mode --name ${ticketBranch} --set multiple-plan\` before asking for a ship request`,
				};
			}

			if (plans.length === 0) {
				return { error: `a ship request names the plans it approves, and none was given — name every plan ticket ${ticketBranch} still includes` };
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

			return appendTicketEvent({
				record: { ...record, shipRequest: { planIds, requestedAt: at } },
				kind: TicketEventKind.ShipRequested,
				detail: `ticket ${ticketBranch} is to ship once ${planIds.join(', ')} are implemented`,
				at,
			});
		},
	});
