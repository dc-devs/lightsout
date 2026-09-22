import { getRequiredFlag } from '#src/cli/common/args/getRequiredFlag.ts';
import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { describePlanProgress } from '#src/cli/workOrder/common/utils/describePlanProgress.ts';
import { finishWorkOrderChange } from '#src/cli/workOrder/common/utils/finishWorkOrderChange.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { PlanProgress } from '#src/contracts/index.ts';
import { addWorkOrderPlan } from '#src/workOrder/index.ts';

/**
 * `lightsout work-order add-plan` at the terminal, in both its forms.
 *
 * `--from` names a plan folder's bare name under the plans directory, so it is
 * passed through exactly as typed rather than resolved here. The plan's address
 * is the last line on stdout, because that is the one thing a calling skill
 * reads back — everything else the command has to say goes above it, and for a
 * `--from` add that is where the files came from and how far the plan already
 * got, which an empty plan's line would say nothing about.
 */
export const workOrderAddPlanCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const name = await getRequiredFlag({ flags, name: 'name' });
	const slug = await getRequiredFlag({ flags, name: 'slug' });
	const from = getStringFlag({ flags, name: 'from' });
	const config = await readConfig({ cwd });
	const outcome = await addWorkOrderPlan({
		cwd,
		name,
		slug,
		title: getStringFlag({ flags, name: 'title' }),
		from,
		config,
		env: process.env,
		onProgress: createProgressPrinter(),
	});

	await finishWorkOrderChange({
		name,
		outcome,
		describe: ({ address, record }) => {
			// A record answered without a plan entry never prints `undefined`.
			const progress = record.plans.at(-1)?.progress ?? PlanProgress.Planning;

			return [
				from === undefined
					? `ticket ${name} now holds ${record.plans.length} plan(s), the newest of them:`
					: `the loose files of '${from}' are now this ticket's newest plan, ${describePlanProgress({ progress })}:`,
				address,
			];
		},
	});
};
