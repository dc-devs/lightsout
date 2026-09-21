import { getListFlag } from '#src/cli/common/args/getListFlag.ts';
import { getRequiredFlag } from '#src/cli/common/args/getRequiredFlag.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { finishWorkOrderChange } from '#src/cli/workOrder/common/utils/finishWorkOrderChange.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { requestTicketShip, withdrawTicketShipRequest } from '#src/ticket/index.ts';

/**
 * `lightsout work-order request-ship` at the terminal.
 *
 * Recording a request and withdrawing one are opposite changes to the same
 * field, so naming both — or neither — is refused rather than guessed at. The
 * plan tokens are handed on exactly as typed: a bare number and a full id are
 * both accepted, and the operation resolves them against the ticket's plans.
 */
export const workOrderRequestShipCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const ticketBranch = await getRequiredFlag({ flags, name: 'name' });
	const plans = getListFlag({ flags, name: 'plans' });
	const withdraw = flags.get('withdraw') === true;

	if ((plans !== undefined) === withdraw) {
		console.error(
			'`lightsout work-order request-ship` takes exactly one of --plans <id,id> and --withdraw: the first records a request, the second takes one back',
		);

		return exitCli({ code: 1 });
	}

	const config = await readConfig({ cwd });
	const shared = { cwd, ticketBranch, config, env: process.env, onProgress: createProgressPrinter() };
	const outcome = plans === undefined ? await withdrawTicketShipRequest(shared) : await requestTicketShip({ ...shared, plans });

	await finishWorkOrderChange({
		ticketBranch,
		outcome,
		describe: ({ record }) => [
			record.shipRequest === undefined
				? `ticket ${ticketBranch} carries no ship request, so it stays open`
				: `ticket ${ticketBranch} is to ship once ${record.shipRequest.planIds.join(', ')} are implemented`,
		],
	});
};
