import { getRequiredFlag } from '#src/cli/common/args/getRequiredFlag.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { finishWorkOrderChange } from '#src/cli/workOrder/common/utils/finishWorkOrderChange.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { retitleTicketPlan } from '#src/ticket/index.ts';

/**
 * `lightsout work-order retitle-plan` at the terminal.
 *
 * A title is not identity: the plan's id, its folder and any pending ship
 * request are untouched, which is why a rename is the one change to a ticket
 * that never costs it an approval.
 */
export const workOrderRetitlePlanCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const ticketBranch = await getRequiredFlag({ flags, name: 'name' });
	const plan = await getRequiredFlag({ flags, name: 'plan' });
	const title = await getRequiredFlag({ flags, name: 'title' });
	const config = await readConfig({ cwd });
	const outcome = await retitleTicketPlan({ cwd, ticketBranch, plan, title, config, env: process.env, onProgress: createProgressPrinter() });

	await finishWorkOrderChange({ ticketBranch, outcome, describe: () => [`the plan is now titled '${title}' on ticket ${ticketBranch}`] });
};
