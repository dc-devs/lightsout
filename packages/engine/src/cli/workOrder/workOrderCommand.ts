import { getPositionals } from '#src/cli/common/args/getPositionals.ts';
import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { usage } from '#src/cli/common/constants/usage.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { workOrderAddPlanCommand } from '#src/cli/workOrder/workOrderAddPlanCommand.ts';
import { workOrderExcludePlanCommand } from '#src/cli/workOrder/workOrderExcludePlanCommand.ts';
import { workOrderModeCommand } from '#src/cli/workOrder/workOrderModeCommand.ts';
import { workOrderRequestShipCommand } from '#src/cli/workOrder/workOrderRequestShipCommand.ts';
import { workOrderRetitlePlanCommand } from '#src/cli/workOrder/workOrderRetitlePlanCommand.ts';
import { workOrderShowCommand } from '#src/cli/workOrder/workOrderShowCommand.ts';
import { workOrderSyncCommand } from '#src/cli/workOrder/workOrderSyncCommand.ts';
import { parsePlanAddress } from '#src/common/planAddress/parsePlanAddress.ts';
import { workOrderNameOf } from '#src/common/planAddress/workOrderNameOf.ts';

/** Each subcommand word and the handler it reaches, in the order the usage text lists them. */
const workOrderSubcommands: Record<string, (context: CommandContext) => Promise<void>> = {
	'add-plan': workOrderAddPlanCommand,
	mode: workOrderModeCommand,
	'request-ship': workOrderRequestShipCommand,
	'exclude-plan': workOrderExcludePlanCommand,
	'retitle-plan': workOrderRetitlePlanCommand,
	show: workOrderShowCommand,
	sync: workOrderSyncCommand,
};

/**
 * The `work-order` command word, dispatching on its first positional.
 *
 * It resolves no config and no driver: no subcommand spawns an agent, and each
 * one reads the repository's config itself. Every subcommand acts on a whole
 * ticket, so a plan's own address given as `--name` is refused here rather than
 * seven times over — a plan address would otherwise name a folder that holds no
 * record at all.
 */
export const workOrderCommand = async ({ flags, rest, cwd }: CommandContext): Promise<void> => {
	const word = getPositionals({ args: rest })[0] ?? '';
	const subcommand = workOrderSubcommands[word];

	if (subcommand === undefined) {
		console.error(usage);

		return exitCli({ code: 1 });
	}

	const name = getStringFlag({ flags, name: 'name' });

	if (name !== undefined && parsePlanAddress({ name }) !== undefined) {
		console.error(
			`\`lightsout work-order ${word}\` acts on a whole ticket, so --name takes the ticket's branch rather than one plan's address — name ${workOrderNameOf({ name })} instead`,
		);

		return exitCli({ code: 1 });
	}

	await subcommand({ flags, rest, cwd });
};
