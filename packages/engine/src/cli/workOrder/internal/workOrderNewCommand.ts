import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { createProgressPrinter } from '#src/cli/internal/common/utils/createProgressPrinter.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { createWorkOrder } from '#src/workOrder/createWorkOrder.ts';

/**
 * `lightsout work-order new` at the terminal.
 *
 * Neither `--ticket` nor `--title` is read as a required flag, because the PAIR
 * is what is required rather than either one — the creator is the one place
 * that rule is stated. The new work order's label is the last line on stdout,
 * because that is the one thing a calling skill reads back, so the branch it
 * implements on is printed above it.
 *
 * It does not go through the record-change finisher the subcommands that change
 * an existing record use: there is no pending ship request to withdraw and no
 * publish to report, so both of those endings would say nothing.
 */
export const workOrderNewCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const config = await readConfig({ cwd });
	const created = await createWorkOrder({
		cwd,
		ticketRef: getStringFlag({ flags, name: 'ticket' }),
		title: getStringFlag({ flags, name: 'title' }),
		config,
		env: process.env,
		onProgress: createProgressPrinter(),
	});

	if ('error' in created) {
		console.error(created.error);

		return exitCli({ code: 1 });
	}

	console.log(`work order ${created.name} implements on branch ${created.branch}`);
	console.log(created.name);

	return exitCli({ code: 0 });
};
