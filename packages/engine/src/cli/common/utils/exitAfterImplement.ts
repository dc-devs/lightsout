import { contradictoryShipFlagsMessage } from '#src/cli/common/constants/contradictoryShipFlagsMessage.ts';
import { unusableTicketPatternMessage } from '#src/cli/common/constants/unusableTicketPatternMessage.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { exitForRunResult } from '#src/cli/common/utils/exitForRunResult.ts';
import { type LightsoutConfig, ShipStatus } from '#src/contracts/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import { resolveShipIntent, runShip } from '#src/ship/index.ts';

interface Params {
	config: LightsoutConfig;
	cwd: string;
	/** How the run ended. A failed or paused run never ships. */
	result: PipelineResult;
	/** Whether `--ship` was typed. The config's `after-implement` is the other way in. */
	shipFlag: boolean;
	/** Whether `--no-ship` was typed. Beats the config's `after-implement`. */
	noShipFlag: boolean;
	/** The process environment, read for the queue's own suppression variable. Passed rather than read, so a test never needs to mutate `process.env`. */
	env: NodeJS.ProcessEnv;
}

/**
 * End an implement run, shipping the branch first when the run passed and
 * someone asked for it.
 *
 * Whether anyone asked is `resolveShipIntent`'s answer, not this function's —
 * the command that started the run resolved the same intent from the same
 * inputs and stamped it on the manifest, so the row the progress view draws and
 * the ship that happens here cannot disagree.
 *
 * Shipping is opt-in both ways and never the default: implement's end state
 * stays a verified diff a human can still review before it becomes the default
 * branch. A `--ship` asked for against an unusable ticket pattern is a loud
 * exit-1 usage error rather than a silent skip — the user is not getting the
 * ship they asked for, and the message has to say so. A blocked ship after a
 * passed run also exits 1, with the ship result already on disk: the code is
 * verified, the merge is not done, and that is the honest report.
 */
export const exitAfterImplement = async ({ config, cwd, result, shipFlag, noShipFlag, env }: Params): Promise<never> => {
	const intent = resolveShipIntent({ config, shipFlag, noShipFlag, env });

	if (intent.contradictory) {
		console.error(contradictoryShipFlagsMessage);

		return exitCli({ code: 1 });
	}

	if (!result.ok || !intent.willShip) {
		return exitForRunResult({ ok: result.ok, manifest: result.manifest });
	}

	if (intent.settings === undefined) {
		console.error(unusableTicketPatternMessage);

		return exitCli({ code: 1 });
	}

	const shipped = await runShip({ cwd, settings: intent.settings, onProgress: createProgressPrinter() });

	return shipped.status === ShipStatus.Blocked ? exitCli({ code: 1 }) : exitForRunResult({ ok: result.ok, manifest: result.manifest });
};
