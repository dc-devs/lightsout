import { unusableTicketPatternMessage } from '#src/cli/common/constants/unusableTicketPatternMessage.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { resolveEffectiveConfigAndDriver } from '#src/cli/common/utils/resolveEffectiveConfigAndDriver.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { ShipStatus } from '#src/contracts/index.ts';
import { resolveShipSettings, runShip } from '#src/ship/index.ts';
import { reconcileShippedTicket } from '#src/ticketLifecycle/index.ts';

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

	// The `implement` entry, not the top-level harness: resolving a merge
	// conflict and repairing a red gate is implementation work, so the recovery
	// spawns whatever this repository picked for implementing. The ship settings
	// still come from the config as read — a harness override touches no `ship` key.
	const { config: effectiveConfig, driver } = resolveEffectiveConfigAndDriver({ config, command: 'implement' });
	const result = await runShip({ cwd, settings, integration: { config: effectiveConfig, driver }, onProgress: createProgressPrinter() });

	if (result.status === ShipStatus.Shipped) {
		console.log(`shipped ${result.ticketRef}: pull request #${result.prNumber} merged as ${result.mergeCommit}`);
		console.log(`  ${result.prUrl}`);

		// A standalone ship is a workflow entry point like any other, so the
		// tracker learns the same thing here as it does from the queue's merge. A
		// tracker that refuses the write does not change the exit code: the merge
		// happened, and saying otherwise would be the one report that is false.
		const reconciliationFailure = await reconcileShippedTicket({ config, env: process.env, ticketRef: result.ticketRef, onProgress: createProgressPrinter() });

		if (reconciliationFailure !== undefined) {
			console.error(reconciliationFailure);
		}

		return exitCli({ code: 0 });
	}

	console.error(`ship blocked (${result.reason}): ${result.detail}`);

	if (result.failingChecks.length > 0) {
		console.error(`  checks: ${result.failingChecks.join(', ')}`);
	}

	return exitCli({ code: 1 });
};
