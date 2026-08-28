import { unusableTicketPatternMessage } from '#src/cli/common/constants/unusableTicketPatternMessage.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { exitForRunResult } from '#src/cli/common/utils/exitForRunResult.ts';
import { type LightsoutConfig, ShipStatus } from '#src/contracts/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import { resolveShipSettings, runShip } from '#src/ship/index.ts';

interface Params {
	config: LightsoutConfig;
	cwd: string;
	/** How the run ended. A failed or paused run never ships. */
	result: PipelineResult;
	/** Whether `--ship` was typed. The config's `after-implement` is the other way in. */
	shipFlag: boolean;
}

/**
 * End an implement run, shipping the branch first when the run passed and
 * someone asked for it.
 *
 * Shipping is opt-in both ways and never the default: implement's end state
 * stays a verified diff a human can still review before it becomes the default
 * branch. A `--ship` asked for against an unusable ticket pattern is a loud
 * exit-1 usage error rather than a silent skip — the user is not getting the
 * ship they asked for, and the message has to say so. A blocked ship after a
 * passed run also exits 1, with the ship result already on disk: the code is
 * verified, the merge is not done, and that is the honest report.
 */
export const exitAfterImplement = async ({ config, cwd, result, shipFlag }: Params): Promise<never> => {
	const settings = resolveShipSettings({ config });

	if (!result.ok || !(shipFlag || settings?.afterImplement === true)) {
		return exitForRunResult({ ok: result.ok, manifest: result.manifest });
	}

	if (settings === undefined) {
		console.error(unusableTicketPatternMessage);

		return exitCli({ code: 1 });
	}

	const shipped = await runShip({ cwd, settings, onProgress: createProgressPrinter() });

	return shipped.status === ShipStatus.Blocked ? exitCli({ code: 1 }) : exitForRunResult({ ok: result.ok, manifest: result.manifest });
};
