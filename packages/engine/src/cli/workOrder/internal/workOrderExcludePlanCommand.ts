import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { getRequiredFlag } from '#src/cli/internal/common/args/getRequiredFlag.ts';
import { createProgressPrinter } from '#src/cli/internal/common/utils/createProgressPrinter.ts';
import { finishWorkOrderChange } from '#src/cli/workOrder/internal/common/utils/finishWorkOrderChange.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { excludeWorkOrderPlan } from '#src/workOrder/excludeWorkOrderPlan.ts';

/**
 * `lightsout work-order exclude-plan` at the terminal.
 *
 * The progress printer matters here rather than being decoration: excluding a
 * plan whose implementation started runs this repository's own full gates on
 * the ticket branch, which can take minutes.
 */
export const workOrderExcludePlanCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const name = await getRequiredFlag({ flags, name: 'name' });
	const plan = await getRequiredFlag({ flags, name: 'plan' });
	const reason = await getRequiredFlag({ flags, name: 'reason' });
	const config = await readConfig({ cwd });
	const outcome = await excludeWorkOrderPlan({
		cwd,
		name,
		plan,
		reason,
		implementationRemoved: flags.get('implementation-removed') === true,
		config,
		env: process.env,
		onProgress: createProgressPrinter(),
	});

	await finishWorkOrderChange({
		name,
		outcome,
		describe: ({ record }) => [
			`ticket ${name} now includes ${record.plans.filter((candidate) => candidate.exclusion === undefined).length} plan(s); the excluded plan's files stay on disk`,
		],
	});
};
