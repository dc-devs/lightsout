import { getRequiredFlag } from '#src/cli/common/args/getRequiredFlag.ts';
import { bold } from '#src/cli/common/terminal/bold.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { publishPlan } from '#src/plan/index.ts';

/**
 * `lightsout plan publish` at the terminal.
 *
 * It spawns no agent, so it resolves no driver — the shape
 * `planVerifyFactsCommand` already sets. The config is read with `readConfig`
 * rather than the optional reader: publishing needs a `ticket-tracker` block, so
 * a repo with no config has nothing to resolve and is refused by name, the way
 * `queueCommand` treats the same requirement.
 *
 * A stale attachment does not change the exit code. The publish succeeded, and
 * an attachment publish deliberately did not delete is the approver's to remove
 * in the tracker if they want it gone.
 */
export const planPublishCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const name = await getRequiredFlag({ flags, name: 'name' });
	const config = await readConfig({ cwd });
	const report = await publishPlan({ cwd, name, config, env: process.env, onProgress: createProgressPrinter() });

	if (report.error !== undefined) {
		console.error(`\n${report.error}`);
		return exitCli({ code: 1 });
	}

	console.log(`\n${bold(`plan publish ${name}`)} — ${report.published.length} file(s) attached to ${report.ticketRef}`);

	for (const file of report.published) {
		console.log(`  ${file}`);
	}

	if (report.stale.length > 0) {
		console.log(`\nstill on ${report.ticketRef} from an earlier publish, and not written by this run: ${report.stale.join(', ')} — publish deleted nothing.`);
	}

	return exitCli({ code: 0 });
};
