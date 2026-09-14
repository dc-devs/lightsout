import { getRequiredFlag } from '#src/cli/common/args/getRequiredFlag.ts';
import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { finishTicketChange } from '#src/cli/ticket/common/utils/finishTicketChange.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { addTicketPlan } from '#src/ticket/index.ts';

/**
 * `lightsout ticket add-plan` at the terminal.
 *
 * The plan's address is the last line on stdout, because that is the one thing
 * a calling skill reads back — everything else the command has to say goes
 * above it.
 */
export const ticketAddPlanCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const ticketBranch = await getRequiredFlag({ flags, name: 'name' });
	const slug = await getRequiredFlag({ flags, name: 'slug' });
	const config = await readConfig({ cwd });
	const outcome = await addTicketPlan({
		cwd,
		ticketBranch,
		slug,
		title: getStringFlag({ flags, name: 'title' }),
		config,
		env: process.env,
		onProgress: createProgressPrinter(),
	});

	await finishTicketChange({
		ticketBranch,
		outcome,
		describe: ({ address, record }) => [`ticket ${ticketBranch} now holds ${record.plans.length} plan(s), the newest of them:`, address],
	});
};
