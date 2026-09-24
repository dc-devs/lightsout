import { getRequiredFlag } from '#src/cli/common/args/getRequiredFlag.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { describePlanProgress } from '#src/cli/workOrder/common/utils/describePlanProgress.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { describeMissingWorkOrder } from '#src/common/utils/describeMissingWorkOrder.ts';
import type { WorkOrderState } from '#src/contracts/index.ts';
import { pullWorkOrderState } from '#src/workOrder/index.ts';

/** One line per plan, and one each for what the work order is waiting on. */
const renderWorkOrderState = ({ record }: { record: WorkOrderState }) => [
	// The label leads, because it is what every other subcommand is typed with;
	// the branch follows, because a prefixed one cannot be read off the label.
	`work order ${record.name} on branch ${record.branch} — ${record.mode} mode${record.ticketRef === undefined ? '' : ` — ${record.ticketRef}`}`,
	...record.plans.map((plan) => {
		const excluded = plan.exclusion === undefined ? '' : ` — excluded: ${plan.exclusion.reason}`;

		return `  ${plan.id} — ${plan.title} — ${describePlanProgress({ progress: plan.progress })}${excluded}`;
	}),
	// A work order holding no plan 001 ships on its build from the ticket body, so that build is shown like a plan.
	...(record.ticketBodyBuild === undefined ? [] : [`  built from the ticket body — ${describePlanProgress({ progress: record.ticketBodyBuild.progress })}`]),
	record.shipRequest === undefined
		? 'no ship request is pending, so this work order stays open'
		: `ship request: ${record.shipRequest.planIds.join(', ')} — the work order ships once every one of them is implemented`,
	...(record.shipped === undefined ? [] : [`shipped as ${record.shipped.mergeCommit}`]),
];

/**
 * `lightsout work-order show` at the terminal.
 *
 * The record is pulled rather than read, so a copy another machine published is
 * taken first and a divergence is reported instead of a stale answer being
 * shown as the truth.
 */
export const workOrderShowCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const name = await getRequiredFlag({ flags, name: 'name' });
	const config = await readConfig({ cwd });
	const pulled = await pullWorkOrderState({ cwd, name, config, env: process.env, onProgress: createProgressPrinter() });

	if ('error' in pulled) {
		console.error(pulled.error);

		return exitCli({ code: 1 });
	}

	if (pulled.record === undefined) {
		console.error(describeMissingWorkOrder({ name }));

		return exitCli({ code: 1 });
	}

	for (const line of renderWorkOrderState({ record: pulled.record })) {
		console.log(line);
	}

	return exitCli({ code: 0 });
};
