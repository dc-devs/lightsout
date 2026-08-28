import { unusableTicketPatternMessage } from '#src/cli/common/constants/unusableTicketPatternMessage.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { ShipStatus } from '#src/contracts/index.ts';
import { resolveShipSettings, runShip } from '#src/ship/index.ts';

/**
 * `lightsout ship` — the current branch, from committed work to merged.
 *
 * An unusable `ship.ticket-pattern` is answered here rather than by the ship
 * sequence: it is a startup usage error like every other bad flag, and no
 * result file is written for it, because a result file records a run and no run
 * happened.
 */
export const shipCommand = async ({ cwd }: CommandContext): Promise<void> => {
	const config = await readConfig({ cwd });
	const settings = resolveShipSettings({ config });

	if (settings === undefined) {
		console.error(unusableTicketPatternMessage);
		return exitCli({ code: 1 });
	}

	const result = await runShip({ cwd, settings, onProgress: createProgressPrinter() });

	if (result.status === ShipStatus.Shipped) {
		console.log(`shipped ${result.ticketRef}: pull request #${result.prNumber} merged as ${result.mergeCommit}`);
		console.log(`  ${result.prUrl}`);

		return exitCli({ code: 0 });
	}

	console.error(`ship blocked (${result.reason}): ${result.detail}`);

	if (result.failingChecks.length > 0) {
		console.error(`  checks: ${result.failingChecks.join(', ')}`);
	}

	return exitCli({ code: 1 });
};
