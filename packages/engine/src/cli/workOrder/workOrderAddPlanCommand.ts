import { getRequiredFlag } from '#src/cli/common/args/getRequiredFlag.ts';
import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { finishWorkOrderChange } from '#src/cli/workOrder/common/utils/finishWorkOrderChange.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { addWorkOrderPlan } from '#src/workOrder/addWorkOrderPlan.ts';

/**
 * `lightsout work-order add-plan` at the terminal.
 *
 * The plan's address is the last line on stdout, because that is the one thing
 * a calling skill reads back — everything else the command has to say goes
 * above it.
 */
export const workOrderAddPlanCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const name = await getRequiredFlag({ flags, name: 'name' });
	const slug = await getRequiredFlag({ flags, name: 'slug' });
	const config = await readConfig({ cwd });
	const outcome = await addWorkOrderPlan({
		cwd,
		name,
		slug,
		title: getStringFlag({ flags, name: 'title' }),
		config,
		env: process.env,
		onProgress: createProgressPrinter(),
	});

	await finishWorkOrderChange({
		name,
		outcome,
		describe: ({ address, record }) => [`work order ${name} now holds ${record.plans.length} plan(s), the newest of them:`, address],
	});
};
