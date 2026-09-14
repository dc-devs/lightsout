import { getRequiredFlag } from '#src/cli/common/args/getRequiredFlag.ts';
import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { syncTicketRecord, TicketSyncKeep } from '#src/ticket/index.ts';

/**
 * `lightsout ticket sync` at the terminal.
 *
 * With no `--keep` this is the ordinary pull-and-catch-up, which is also how a
 * publish that failed earlier is retried. `--keep` carries out a decision about
 * a divergence, so a word naming neither copy is refused rather than guessed
 * at: keeping one copy sets the other one aside.
 */
export const ticketSyncCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const ticketBranch = await getRequiredFlag({ flags, name: 'name' });
	const asked = getStringFlag({ flags, name: 'keep' });
	const keep = Object.values(TicketSyncKeep).find((candidate) => candidate === asked);

	if (asked !== undefined && keep === undefined) {
		console.error(`--keep takes ${Object.values(TicketSyncKeep).join(' or ')}, and '${asked}' is neither`);

		return exitCli({ code: 1 });
	}

	const config = await readConfig({ cwd });
	const synced = await syncTicketRecord({ cwd, ticketBranch, config, env: process.env, keep, onProgress: createProgressPrinter() });

	if ('error' in synced) {
		console.error(synced.error);

		return exitCli({ code: 1 });
	}

	console.log(
		keep === undefined
			? `the ticket record for ${ticketBranch} and the copy on ${synced.record.ticketRef} are in sync`
			: `the ${keep} copy of ${ticketBranch}'s record is now the one on both sides`,
	);

	return exitCli({ code: 0 });
};
