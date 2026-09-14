import { readResumedPlanName } from '#src/cli/common/implementRun/readResumedPlanName.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { resolveCommandShipIntent } from '#src/cli/common/utils/resolveCommandShipIntent.ts';
import { type LightsoutConfig, PipelineKind, type RunManifest } from '#src/contracts/index.ts';
import type { ShipIntent } from '#src/ship/index.ts';
import { readTicketRunTerms } from '#src/ticket/index.ts';
import { requireImplementLifecycle } from '#src/ticketLifecycle/index.ts';

interface Params {
	/** The checkout the parked run recorded its source work in. */
	workspace: string;
	/** The parked run being continued. */
	manifest: RunManifest;
	/** The repository's config as read, before any harness resolution. */
	loaded: LightsoutConfig;
	flags: CommandContext['flags'];
}

/**
 * Everything a continuation has to clear before anything is mutated: the plan
 * the parked run belongs to, what that plan's ticket record says about running
 * it again, the ship terms this continuation carries, and the pre-source
 * lifecycle write its branch's ticket owes.
 *
 * They are asked in this order, and all of them of the WORKSPACE, because the
 * branch the run builds on is the one they all answer for. A plan the ticket has
 * since taken out of the order therefore leaves no trace of having been resumed:
 * no tracker write, no restamped manifest.
 *
 * Each refusal is REPORTED here and answered as undefined, the way
 * `resolveCommandShipIntent` reports its own contradiction — the caller has only
 * to exit.
 *
 * @returns the plan name and the ship intent, or undefined when something refused the resume
 */
export const readResumeClearance = async ({
	workspace,
	manifest,
	loaded,
	flags,
}: Params): Promise<{ name: string | undefined; shipIntent: ShipIntent } | undefined> => {
	const name = await readResumedPlanName({ cwd: workspace, manifest });
	const terms = await readTicketRunTerms({
		cwd: workspace,
		name,
		planPath: manifest.pipeline === PipelineKind.Direct ? undefined : manifest.plan,
	});

	if (terms.refusal !== undefined) {
		console.error(terms.refusal);

		return undefined;
	}

	// A resumed run ships on the same terms a first run does: whatever the config,
	// the flags and the ticket say, settled here rather than inherited. A fix, a
	// resume and a merge is the whole point of parking, and a run that had to be
	// resumed is not a run that deserves to end unshipped and unmentioned.
	const shipIntent = resolveCommandShipIntent({ config: loaded, flags, env: process.env, shipRequest: terms.shipRequest });

	if (shipIntent === undefined) {
		return undefined;
	}

	// Every pipeline still here writes source, so each owes the pre-source
	// lifecycle write the implement entries already make. It is also what refuses a
	// ticket under a gate hold. No `ticketRef`: a resumed run is ticket-backed
	// through its branch, which the guard reads for itself.
	const refusal = await requireImplementLifecycle({ cwd: workspace, config: loaded, env: process.env, onProgress: createProgressPrinter() });

	if (refusal !== undefined) {
		console.error(refusal);

		return undefined;
	}

	return { name, shipIntent };
};
