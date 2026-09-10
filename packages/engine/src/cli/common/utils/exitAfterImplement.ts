import { contradictoryShipFlagsMessage } from '#src/cli/common/constants/contradictoryShipFlagsMessage.ts';
import { unusableTicketPatternMessage } from '#src/cli/common/constants/unusableTicketPatternMessage.ts';
import { removeShippedRunWorkspace } from '#src/cli/common/implementRun/removeShippedRunWorkspace.ts';
import { resolveRunCwd } from '#src/cli/common/implementRun/resolveRunCwd.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { exitForRunResult } from '#src/cli/common/utils/exitForRunResult.ts';
import { resolveEffectiveConfigAndDriver } from '#src/cli/common/utils/resolveEffectiveConfigAndDriver.ts';
import { type LightsoutConfig, ShipStatus } from '#src/contracts/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import { resolveShipIntent, runShip } from '#src/ship/index.ts';
import { reconcileShippedTicket } from '#src/ticketLifecycle/index.ts';

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
 *
 * The ship runs in the checkout the run's manifest recorded, so a caller that
 * hands over the launching checkout and a caller that hands over the workspace
 * both ship the right tree. A confirmed merge then takes the workspace down
 * before the tracker write, mirroring `shipOneBranch`: the local cleanup
 * happens while the merge is the freshest fact, and the write that can fail
 * without undoing anything comes last.
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

	// A gate, a push or a merge run against the checkout the command was launched
	// from would act on a tree the run was never building in, so the ship goes
	// where the run's own records say the work happened.
	const resolved = await resolveRunCwd({ cwd, manifest: result.manifest });

	if ('error' in resolved) {
		console.error(resolved.error);

		return exitCli({ code: 1 });
	}

	const workCwd = resolved.workspace;

	// Same harness the run itself used: the branch reaching the remote has the
	// default branch merged into it, and settling that is implementation work.
	const { config: effectiveConfig, driver } = resolveEffectiveConfigAndDriver({ config, command: 'implement' });
	const shipped = await runShip({
		cwd: workCwd,
		settings: intent.settings,
		integration: { config: effectiveConfig, driver },
		onProgress: createProgressPrinter(),
	});

	if (shipped.status === ShipStatus.Blocked) {
		return exitCli({ code: 1 });
	}

	// Only a lightsout-created standalone worktree comes down, and only now that
	// the merge is confirmed: the ownership record is what licenses it, so a
	// checkout the user selected themselves is never removed.
	await removeShippedRunWorkspace({ cwd: workCwd, manifest: result.manifest, onProgress: createProgressPrinter() });

	// The merge is confirmed here too, so the tracker learns it here too — and a
	// refused write is a printed sentence rather than a changed exit code,
	// because a tracker failure cannot undo a merge that already happened.
	const reconciliationFailure = await reconcileShippedTicket({ config, env, ticketRef: shipped.ticketRef, onProgress: createProgressPrinter() });

	if (reconciliationFailure !== undefined) {
		console.error(reconciliationFailure);
	}

	return exitForRunResult({ ok: result.ok, manifest: result.manifest });
};
