import { planNumberOf } from '#src/common/planAddress/planNumberOf.ts';
import { type LightsoutConfig, PlanProgress, WorkOrderEventKind, WorkOrderMode, type WorkOrderPlan, type WorkOrderState } from '#src/contracts/index.ts';
import { resolveShipSettings } from '#src/ship/index.ts';
import { appendTicketEvent } from '#src/ticket/common/record/appendTicketEvent.ts';
import { changeExistingTicketRecord } from '#src/ticket/common/record/changeExistingTicketRecord.ts';
import { isPlanImplementationStarted } from '#src/ticket/common/record/isPlanImplementationStarted.ts';
import { recordShipRequestWithdrawal } from '#src/ticket/common/record/recordShipRequestWithdrawal.ts';
import type { TicketRecordChange } from '#src/ticket/common/types/TicketRecordChange.ts';

interface Params {
	/** Any checkout of the repository: the one record this machine holds is found from it. */
	cwd: string;
	/** The ticket folder's name, which is also the branch its plans implement on. */
	ticketBranch: string;
	mode: WorkOrderMode;
	/** Whether the human has approved the consequences a switch to single-plan mode spells out. */
	approve: boolean;
	config: LightsoutConfig;
	/** The process environment the tracker API key is read from. */
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

/** The reason an approved switch records against every plan it drops, fixed so the history reads the same on every ticket. */
const switchedToSinglePlan = 'switched to single-plan mode';

/** Every plan above 001, which is the set a switch to single-plan mode is about. */
const laterPlansOf = ({ record }: { record: WorkOrderState }) => record.plans.filter((plan) => planNumberOf({ id: plan.id }) !== 1);

/** A plan whose implementation started and whose removal from the branch has not been recorded and verified. */
const isUnaccountedImplementation = ({ plan }: { plan: WorkOrderPlan }) =>
	isPlanImplementationStarted({ plan }) && !(plan.exclusion?.implementationRemoved === true && plan.exclusion.verifiedCommit !== undefined);

/**
 * What approving the switch actually does to this ticket, stated in full before
 * it is done.
 *
 * Every shipping path is named, because nothing ships at the moment the mode
 * changes and the human has to see which command or which drain would. The
 * repository's own `ship.after-implement` value is read rather than described
 * in general, so the sentence is about this repository.
 */
const describeSwitchToSinglePlan = ({
	record,
	first,
	later,
	afterImplement,
}: {
	record: WorkOrderState;
	first: WorkOrderPlan;
	later: WorkOrderPlan[];
	afterImplement: boolean;
}) => {
	const firstId = first.id;
	const chaining = afterImplement
		? `\`ship.after-implement\` is true in this repository, so a passed \`lightsout implement\` or \`lightsout resume\` run of plan ${firstId} chains straight into shipping`
		: `\`ship.after-implement\` is false in this repository, so the ticket ships only when you run \`lightsout ship\``;
	const eligible =
		first.progress === PlanProgress.Implemented
			? ` Plan ${firstId} is already implemented, so this ticket becomes eligible to ship as soon as the switch is approved: \`lightsout ship\`, or the queue's next drain, would ship it.`
			: '';

	return `switching ticket ${record.branch} to single-plan mode means plan ${firstId} alone determines this ticket's implementation and shipping, and ${later.map((plan) => plan.id).join(', ')} would be excluded from both — their files stay on disk, and an exclusion is final. ${chaining}, and the queue ships the branch once plan ${firstId} is implemented whatever that setting says.${eligible} Run the same command again with --approve to make the switch.`;
};

/** Take every later plan out of the ticket's implementation order, one recorded exclusion each, in number order. */
const excludeDroppedPlans = ({ record, dropped, at }: { record: WorkOrderState; dropped: WorkOrderPlan[]; at: string }) => {
	let carried = record;

	for (const plan of dropped) {
		carried = appendTicketEvent({
			record: {
				...carried,
				plans: carried.plans.map((candidate) =>
					candidate.id === plan.id ? { ...candidate, exclusion: { at, reason: switchedToSinglePlan, implementationRemoved: false } } : candidate,
				),
			},
			kind: WorkOrderEventKind.PlanExcluded,
			detail: `plan ${plan.id} was excluded from ticket ${record.branch}: ${switchedToSinglePlan}`,
			at,
		});
	}

	return carried;
};

/** The switch to single-plan mode, once its two refusals and its approval have been settled. */
const switchToSinglePlan = ({
	record,
	afterImplement,
	approve,
	at,
}: {
	record: WorkOrderState;
	afterImplement: boolean;
	approve: boolean;
	at: string;
}): WorkOrderState | { error: string } => {
	const later = laterPlansOf({ record });
	const unaccounted = later.filter((plan) => isUnaccountedImplementation({ plan }));

	if (unaccounted.length > 0) {
		return {
			error: `the implementation of ${unaccounted.map((plan) => plan.id).join(', ')} on ticket ${record.branch} has started, so plan 001 does not alone supply this ticket's implementation — remove that implementation from the branch with the agent, then record it with \`lightsout work-order exclude-plan --implementation-removed\`, and try the switch again`,
		};
	}

	const first = record.plans.find((plan) => planNumberOf({ id: plan.id }) === 1);

	if (first === undefined || first.exclusion !== undefined) {
		return {
			error:
				first === undefined
					? `ticket ${record.branch} holds no plan 001, and single-plan mode is plan 001 supplying the whole implementation`
					: `plan ${first.id} is excluded from ticket ${record.branch}, so single-plan mode would leave the ticket with no implementation at all`,
		};
	}

	const dropped = later.filter((plan) => plan.exclusion === undefined);

	if (dropped.length > 0 && !approve) {
		return { error: describeSwitchToSinglePlan({ record, first, later: dropped, afterImplement }) };
	}

	const excluded = excludeDroppedPlans({ record, dropped, at });
	const withdrawn = recordShipRequestWithdrawal({
		record: excluded,
		detail: `ticket ${record.branch} moved to single-plan mode, so the plans its ship request approved are no longer the ticket's work`,
		at,
	});

	return appendTicketEvent({
		record: { ...withdrawn, mode: WorkOrderMode.SinglePlan },
		kind: WorkOrderEventKind.ModeChanged,
		detail: `ticket ${record.branch} is now in single-plan mode`,
		at,
	});
};

/**
 * Change how a ticket's plans are organised, under the rules each direction
 * carries.
 *
 * To multiple-plan is always allowed and always costs the ticket its automatic
 * shipping: from then on the human declares the finish line with a ship
 * request. To single-plan is a scope reduction, so it is previewed rather than
 * done — running it without `--approve` writes nothing and answers with what
 * approving would do, which is also how declining works: you simply do not run
 * it again.
 *
 * Every rule is evaluated inside the store's change callback against the record
 * the pull settled on, so a preview and a refusal alike leave the record's
 * bytes untouched.
 */
export const setTicketMode = async ({ cwd, ticketBranch, mode, approve, config, env, onProgress }: Params): Promise<TicketRecordChange | { error: string }> => {
	const shipSettings = resolveShipSettings({ config });

	if (shipSettings === undefined) {
		return { error: 'ship.ticket-pattern is not a regular expression capturing a `ticket` group, so this repository cannot say what any branch would ship' };
	}

	const updated = await changeExistingTicketRecord({
		cwd,
		ticketBranch,
		config,
		env,
		onProgress,
		change: (record) => {
			if (record.mode === mode) {
				return { error: `ticket ${ticketBranch} is already in ${mode} mode` };
			}

			const at = new Date().toISOString();

			return mode === WorkOrderMode.SinglePlan
				? switchToSinglePlan({ record, afterImplement: shipSettings.afterImplement, approve, at })
				: appendTicketEvent({
						record: { ...record, mode: WorkOrderMode.MultiplePlan },
						kind: WorkOrderEventKind.ModeChanged,
						detail: `ticket ${ticketBranch} is now in multiple-plan mode`,
						at,
					});
		},
	});

	if ('error' in updated) {
		return updated;
	}

	return {
		...updated,
		notice:
			mode === WorkOrderMode.MultiplePlan
				? `ticket ${ticketBranch} now implements its plans in numeric order, and this repository's automatic shipping no longer applies to it — say when it is finished with \`lightsout work-order request-ship --name ${ticketBranch} --plans <id,id>\``
				: undefined,
	};
};
