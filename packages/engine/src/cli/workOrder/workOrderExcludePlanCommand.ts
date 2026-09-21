import { getRequiredFlag } from '#src/cli/common/args/getRequiredFlag.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { finishWorkOrderChange } from '#src/cli/workOrder/common/utils/finishWorkOrderChange.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { excludeTicketPlan } from '#src/ticket/index.ts';

/**
 * `lightsout work-order exclude-plan` at the terminal.
 *
 * The progress printer matters here rather than being decoration: excluding a
 * plan whose implementation started runs this repository's own full gates on
 * the ticket branch, which can take minutes.
 */
export const workOrderExcludePlanCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const ticketBranch = await getRequiredFlag({ flags, name: 'name' });
	const plan = await getRequiredFlag({ flags, name: 'plan' });
	const reason = await getRequiredFlag({ flags, name: 'reason' });
	const config = await readConfig({ cwd });
	const outcome = await excludeTicketPlan({
		cwd,
		ticketBranch,
		plan,
		reason,
		implementationRemoved: flags.get('implementation-removed') === true,
		config,
		env: process.env,
		onProgress: createProgressPrinter(),
	});

	await finishWorkOrderChange({
		ticketBranch,
		outcome,
		describe: ({ record }) => [
			`ticket ${ticketBranch} now includes ${record.plans.filter((candidate) => candidate.exclusion === undefined).length} plan(s); the excluded plan's files stay on disk`,
		],
	});
};
