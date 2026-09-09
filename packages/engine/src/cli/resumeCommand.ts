import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { usage } from '#src/cli/common/constants/usage.ts';
import { printResult } from '#src/cli/common/render/printResult.ts';
import { printRunHeader } from '#src/cli/common/render/printRunHeader.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitAfterImplement } from '#src/cli/common/utils/exitAfterImplement.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { resolveCommandHarness } from '#src/cli/common/utils/resolveCommandHarness.ts';
import { resolveCommandShipIntent } from '#src/cli/common/utils/resolveCommandShipIntent.ts';
import { runPhasesOrFailFast } from '#src/cli/common/utils/runPhasesOrFailFast.ts';
import { runPipelineOrFailFast } from '#src/cli/common/utils/runPipelineOrFailFast.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { PipelineKind, RunStatus } from '#src/contracts/index.ts';
import { getDriver } from '#src/drivers/index.ts';
import { RunNotFoundError, readRunManifest, writeRunManifest } from '#src/runState/index.ts';
import { requireImplementLifecycle } from '#src/ticketLifecycle/index.ts';

/**
 * Pipelines that own their own resume door, and the whole instruction that
 * sends a reader to it.
 *
 * The instruction rather than a command word, because the doors do not take the
 * same flags: `queue` has no `--run` at all — re-running it IS the resume path —
 * and `implement-direct` is re-run with the ticket it was given. `<id>` is
 * substituted with the run's own; `<path>` has no manifest source and prints as
 * the placeholder a human fills in.
 */
const resumeCommandByPipeline: Record<PipelineKind, string | undefined> = {
	[PipelineKind.Implement]: undefined,
	[PipelineKind.Phases]: undefined,
	[PipelineKind.Refactor]: 'lightsout refactor --run <id>',
	[PipelineKind.Coverage]: 'lightsout test-coverage-to-threshold --run <id>',
	[PipelineKind.Queue]: 'lightsout queue (a restart resumes parked tickets first)',
	[PipelineKind.Direct]: 'lightsout implement-direct --ticket <path> (re-run with the same ticket)',
};

/**
 * The run `--run` names, once every reason this door is the wrong one has been
 * ruled out — a missing flag, an id nothing on disk matches, a pipeline that
 * owns its own resume command, and a run that already passed.
 *
 * Each of those exits the process rather than answering, so whatever this
 * returns is a run resume may genuinely continue.
 */
const readResumableRun = async ({ cwd, flags }: { cwd: string; flags: CommandContext['flags'] }) => {
	const runId = getStringFlag({ flags, name: 'run' });

	if (!runId) {
		console.error(usage);
		return exitCli({ code: 1 });
	}

	// A run id the user typed is theirs to get wrong: an unknown one is a
	// message, never the stack of the manifest path we tried to open.
	const manifest = await readRunManifest({ cwd, runId }).catch((error: unknown) => {
		if (error instanceof RunNotFoundError) {
			console.error(error.message);
			return exitCli({ code: 1 });
		}

		throw error;
	});

	const pipeline = manifest.pipeline ?? PipelineKind.Implement;
	const ownCommand = resumeCommandByPipeline[pipeline];

	if (ownCommand) {
		console.error(`run ${manifest.runId} belongs to the ${pipeline} pipeline — resume it with: ${ownCommand.replaceAll('<id>', manifest.runId)}`);
		return exitCli({ code: 1 });
	}

	if (manifest.status === RunStatus.Passed) {
		console.error(`run ${manifest.runId} already passed — nothing to resume`);
		return exitCli({ code: 1 });
	}

	return { manifest, pipeline };
};

export const resumeCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const skipRefactor = flags.get('skip-refactor') === true;
	const { manifest, pipeline } = await readResumableRun({ cwd, flags });
	const loaded = await readConfig({ cwd });

	// A resumed run ships on the same terms a first run does: whatever the
	// config and the flags say, settled here rather than inherited. A fix, a
	// resume and a merge is the whole point of parking, and a run that had to be
	// resumed is not a run that deserves to end unshipped and unmentioned.
	const shipIntent = resolveCommandShipIntent({ config: loaded, flags, env: process.env });

	if (shipIntent === undefined) {
		return exitCli({ code: 1 });
	}

	// Every pipeline still here is Implement or Phases — the rest were turned away
	// above — and both write source, so both owe the pre-source lifecycle write
	// the implement entries already make. It is also what refuses a ticket under a
	// gate hold, and it runs before the restamp below so a refused resume mutates
	// nothing. No `ticketRef`: a resumed run is ticket-backed through its branch,
	// which the guard reads for itself.
	const refusal = await requireImplementLifecycle({ cwd, config: loaded, env: process.env, onProgress: createProgressPrinter() });

	if (refusal !== undefined) {
		console.error(refusal);
		return exitCli({ code: 1 });
	}

	// Restamped rather than assumed, because the intent is resolved fresh above:
	// the parked run may have carried `--no-ship`, or the config may have gained
	// `after-implement` since. The field means exactly what it says — this run,
	// in this process, will ship — so the progress view draws a ship row when
	// one is coming and none when it is not.
	const resumable =
		(manifest.willShip === true) === shipIntent.willShip ? manifest : await writeRunManifest({ cwd, manifest: { ...manifest, willShip: shipIntent.willShip } });
	const resolved = resolveCommandHarness({ config: loaded, command: 'implement' });
	const driver = getDriver({ name: manifest.harness });
	// Resume truth is the manifest's recorded harness, never the config (decision 6);
	// the implement entry's model applies only when it targets that same harness,
	// while effort applies unconditionally because it is harness-neutral.
	const config = {
		...loaded,
		harness: manifest.harness,
		model: resolved.driverName === manifest.harness ? resolved.model : undefined,
		effort: resolved.effort,
	};

	console.log(`lightsout: resuming run ${manifest.runId} (was: ${manifest.status}, plan: ${manifest.plan})`);
	printRunHeader({ config, driver, cwd });

	const result =
		pipeline === PipelineKind.Phases
			? await runPhasesOrFailFast({ cwd, driver, config, existing: resumable, skipRefactor, onProgress: createProgressPrinter() })
			: await runPipelineOrFailFast({
					cwd,
					driver,
					config,
					existing: resumable,
					skipRefactor,
					onProgress: createProgressPrinter(),
				});

	await printResult({ result, cwd });
	return exitAfterImplement({ config: loaded, cwd, result, shipFlag: flags.get('ship') === true, noShipFlag: flags.get('no-ship') === true, env: process.env });
};
