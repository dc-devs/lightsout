import { getRequiredFlag } from '#src/cli/common/args/getRequiredFlag.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { describePlanProgress } from '#src/cli/ticket/common/utils/describePlanProgress.ts';
import { finishTicketChange } from '#src/cli/ticket/common/utils/finishTicketChange.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { PlanProgress } from '#src/contracts/index.ts';
import { adoptTicketPlan } from '#src/ticket/index.ts';

/**
 * `lightsout ticket adopt` at the terminal.
 *
 * The slug it is given names plan 001's folder and every attachment title for
 * the rest of the ticket's life, so it is passed through exactly as typed. The
 * plan's address is the last line, as it is for every subcommand that makes a
 * plan.
 */
export const ticketAdoptCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const ticketBranch = await getRequiredFlag({ flags, name: 'name' });
	const slug = await getRequiredFlag({ flags, name: 'slug' });
	const config = await readConfig({ cwd });
	const outcome = await adoptTicketPlan({ cwd, ticketBranch, slug, config, env: process.env, onProgress: createProgressPrinter() });

	await finishTicketChange({
		ticketBranch,
		outcome,
		describe: ({ address, record }) => {
			const first = record.plans[0];

			return [
				`the plan folder of ${ticketBranch} is now plan ${first?.id ?? '001'}, ${describePlanProgress({ progress: first?.progress ?? PlanProgress.Planning })}:`,
				address,
			];
		},
	});
};
