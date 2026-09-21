import { getPositionals } from '#src/cli/common/args/getPositionals.ts';
import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { usage } from '#src/cli/common/constants/usage.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { ticketAddPlanCommand } from '#src/cli/ticket/ticketAddPlanCommand.ts';
import { ticketExcludePlanCommand } from '#src/cli/ticket/ticketExcludePlanCommand.ts';
import { ticketModeCommand } from '#src/cli/ticket/ticketModeCommand.ts';
import { ticketRequestShipCommand } from '#src/cli/ticket/ticketRequestShipCommand.ts';
import { ticketRetitlePlanCommand } from '#src/cli/ticket/ticketRetitlePlanCommand.ts';
import { ticketShowCommand } from '#src/cli/ticket/ticketShowCommand.ts';
import { ticketSyncCommand } from '#src/cli/ticket/ticketSyncCommand.ts';
import { parsePlanAddress } from '#src/common/planAddress/parsePlanAddress.ts';
import { ticketFolderOf } from '#src/common/planAddress/ticketFolderOf.ts';

/** Each subcommand word and the handler it reaches, in the order the usage text lists them. */
const ticketSubcommands: Record<string, (context: CommandContext) => Promise<void>> = {
	'add-plan': ticketAddPlanCommand,
	mode: ticketModeCommand,
	'request-ship': ticketRequestShipCommand,
	'exclude-plan': ticketExcludePlanCommand,
	'retitle-plan': ticketRetitlePlanCommand,
	show: ticketShowCommand,
	sync: ticketSyncCommand,
};

/**
 * The `ticket` command word, dispatching on its first positional.
 *
 * It resolves no config and no driver: no subcommand spawns an agent, and each
 * one reads the repository's config itself. Every subcommand acts on a whole
 * ticket, so a plan's own address given as `--name` is refused here rather than
 * seven times over — a plan address would otherwise name a folder that holds no
 * record at all.
 */
export const ticketCommand = async ({ flags, rest, cwd }: CommandContext): Promise<void> => {
	const word = getPositionals({ args: rest })[0] ?? '';
	const subcommand = ticketSubcommands[word];

	if (subcommand === undefined) {
		console.error(usage);

		return exitCli({ code: 1 });
	}

	const name = getStringFlag({ flags, name: 'name' });

	if (name !== undefined && parsePlanAddress({ name }) !== undefined) {
		console.error(
			`\`lightsout ticket ${word}\` acts on a whole ticket, so --name takes the ticket's branch rather than one plan's address — name ${ticketFolderOf({ name })} instead`,
		);

		return exitCli({ code: 1 });
	}

	await subcommand({ flags, rest, cwd });
};
