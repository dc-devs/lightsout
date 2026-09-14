import { getRequiredFlag } from '#src/cli/common/args/getRequiredFlag.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { describePlanProgress } from '#src/cli/ticket/common/utils/describePlanProgress.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { describeMissingTicketRecord } from '#src/common/utils/describeMissingTicketRecord.ts';
import type { TicketRecord } from '#src/contracts/index.ts';
import { pullTicketRecord } from '#src/ticket/index.ts';

/** One line per plan, and one each for what the ticket is waiting on. */
const renderTicketRecord = ({ record }: { record: TicketRecord }) => [
	`ticket ${record.ticketRef} on branch ${record.branch} — ${record.mode} mode`,
	...record.plans.map((plan) => {
		const excluded = plan.exclusion === undefined ? '' : ` — excluded: ${plan.exclusion.reason}`;

		return `  ${plan.id} — ${plan.title} — ${describePlanProgress({ progress: plan.progress })}${excluded}`;
	}),
	record.shipRequest === undefined
		? 'no ship request is pending, so this ticket stays open'
		: `ship request: ${record.shipRequest.planIds.join(', ')} — the ticket ships once every one of them is implemented`,
	...(record.shipped === undefined ? [] : [`shipped as ${record.shipped.mergeCommit}`]),
];

/**
 * `lightsout ticket show` at the terminal.
 *
 * The record is pulled rather than read, so a copy another machine published is
 * taken first and a divergence is reported instead of a stale answer being
 * shown as the truth.
 */
export const ticketShowCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const ticketBranch = await getRequiredFlag({ flags, name: 'name' });
	const config = await readConfig({ cwd });
	const pulled = await pullTicketRecord({ cwd, ticketBranch, config, env: process.env, onProgress: createProgressPrinter() });

	if ('error' in pulled) {
		console.error(pulled.error);

		return exitCli({ code: 1 });
	}

	if (pulled.record === undefined) {
		console.error(describeMissingTicketRecord({ ticketBranch }));

		return exitCli({ code: 1 });
	}

	for (const line of renderTicketRecord({ record: pulled.record })) {
		console.log(line);
	}

	return exitCli({ code: 0 });
};
