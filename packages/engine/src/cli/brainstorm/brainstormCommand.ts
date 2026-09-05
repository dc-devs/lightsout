import { brainstormPublishCommand } from '#src/cli/brainstorm/brainstormPublishCommand.ts';
import { getPositionals } from '#src/cli/common/args/getPositionals.ts';
import { usage } from '#src/cli/common/constants/usage.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';

/**
 * The `brainstorm` command word, dispatching on its first positional.
 *
 * It resolves no config and no driver: `publish` spawns no agent, and it prints
 * no plan-ticket advisory — that belongs to a plan folder being drafted, not to
 * a brainstorm folder being uploaded.
 */
export const brainstormCommand = async ({ flags, rest, cwd }: CommandContext): Promise<void> => {
	if (getPositionals({ args: rest })[0] === 'publish') {
		await brainstormPublishCommand({ flags, rest, cwd });
		return;
	}

	console.error(usage);
	return exitCli({ code: 1 });
};
