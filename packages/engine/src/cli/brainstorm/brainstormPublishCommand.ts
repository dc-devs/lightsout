import { publishBrainstorm } from '#src/brainstorm/index.ts';
import { getRequiredFlag } from '#src/cli/common/args/getRequiredFlag.ts';
import { bold } from '#src/cli/common/terminal/bold.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { readConfig } from '#src/common/config/readConfig.ts';

/**
 * `lightsout brainstorm publish` at the terminal.
 *
 * It spawns no agent, so it resolves no driver. The config is read with
 * `readConfig` rather than the optional reader: publishing needs a
 * `ticket-tracker` block, so a repo with no config has nothing to resolve and is
 * refused by name — the shape `planPublishCommand` already sets.
 */
export const brainstormPublishCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const name = await getRequiredFlag({ flags, name: 'name' });
	const config = await readConfig({ cwd });
	const report = await publishBrainstorm({ cwd, name, config, env: process.env, onProgress: createProgressPrinter() });

	if (report.error !== undefined) {
		console.error(`\n${report.error}`);
		return exitCli({ code: 1 });
	}

	console.log(`\n${bold(`brainstorm publish ${name}`)} — ${report.published.length} file(s) attached to ${report.ticketRef}`);

	for (const file of report.published) {
		console.log(`  ${file}`);
	}

	return exitCli({ code: 0 });
};
