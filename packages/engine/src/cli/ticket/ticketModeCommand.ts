import { getRequiredFlag } from '#src/cli/common/args/getRequiredFlag.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { finishTicketChange } from '#src/cli/ticket/common/utils/finishTicketChange.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { TicketMode } from '#src/contracts/index.ts';
import { setTicketMode } from '#src/ticket/index.ts';

/**
 * `lightsout ticket mode` at the terminal.
 *
 * Without `--approve` a switch to single-plan mode is a preview that changes
 * nothing, so the flag is passed on as the plain boolean it is: an absent
 * `--approve` has to reach the action as false rather than as nothing.
 */
export const ticketModeCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const ticketBranch = await getRequiredFlag({ flags, name: 'name' });
	const asked = await getRequiredFlag({ flags, name: 'set' });
	const mode = Object.values(TicketMode).find((candidate) => candidate === asked);

	if (mode === undefined) {
		console.error(`--set takes ${Object.values(TicketMode).join(' or ')}, and '${asked}' is neither`);

		return exitCli({ code: 1 });
	}

	const config = await readConfig({ cwd });
	const outcome = await setTicketMode({
		cwd,
		ticketBranch,
		mode,
		approve: flags.get('approve') === true,
		config,
		env: process.env,
		onProgress: createProgressPrinter(),
	});

	await finishTicketChange({
		ticketBranch,
		outcome,
		describe: ({ record }) => {
			const excluded = record.plans.filter((plan) => plan.exclusion !== undefined).map((plan) => plan.id);

			return [
				`ticket ${ticketBranch} is now in ${record.mode} mode`,
				...(excluded.length === 0 ? [] : [`excluded from its implementation and its shipping: ${excluded.join(', ')} — their files stay on disk`]),
			];
		},
	});
};
