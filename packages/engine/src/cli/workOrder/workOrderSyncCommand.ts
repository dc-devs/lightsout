import { getRequiredFlag } from '#src/cli/common/args/getRequiredFlag.ts';
import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { syncWorkOrderState, WorkOrderSyncKeep } from '#src/workOrder/index.ts';

/**
 * `lightsout work-order sync` at the terminal.
 *
 * With no `--keep` this is the ordinary pull-and-catch-up, which is also how a
 * publish that failed earlier is retried. `--keep` carries out a decision about
 * a divergence, so a word naming neither copy is refused rather than guessed
 * at: keeping one copy sets the other one aside.
 */
export const workOrderSyncCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const name = await getRequiredFlag({ flags, name: 'name' });
	const asked = getStringFlag({ flags, name: 'keep' });
	const keep = Object.values(WorkOrderSyncKeep).find((candidate) => candidate === asked);

	if (asked !== undefined && keep === undefined) {
		console.error(`--keep takes ${Object.values(WorkOrderSyncKeep).join(' or ')}, and '${asked}' is neither`);

		return exitCli({ code: 1 });
	}

	const config = await readConfig({ cwd });
	const synced = await syncWorkOrderState({ cwd, name, config, env: process.env, keep, onProgress: createProgressPrinter() });

	if ('error' in synced) {
		console.error(synced.error);

		return exitCli({ code: 1 });
	}

	// `sync` refuses a work order with nowhere to publish to, so the tracker-free
	// case never reaches this line — naming the reference only when the record
	// carries one is what keeps that guarantee stated rather than assumed.
	const carrier = synced.record.ticketRef === undefined ? '' : ` on ${synced.record.ticketRef}`;

	console.log(
		keep === undefined
			? `the record for work order ${synced.record.name} and the copy${carrier} are in sync`
			: `the ${keep} copy of ${name}'s record is now the one on both sides`,
	);

	return exitCli({ code: 0 });
};
