import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { usage } from '#src/cli/common/constants/usage.ts';
import { continueDirectRun } from '#src/cli/common/implementRun/continueDirectRun.ts';
import { resolveRunCwd } from '#src/cli/common/implementRun/resolveRunCwd.ts';
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
import { type LightsoutConfig, PipelineKind, type RunManifest, RunStatus } from '#src/contracts/index.ts';
import { type Driver, getDriver } from '#src/drivers/index.ts';
import { RunNotFoundError, readRunManifest, writeRunManifest } from '#src/runState/index.ts';
import { requireImplementLifecycle } from '#src/ticketLifecycle/index.ts';

/**
 * Pipelines that own their own resume door, and the whole instruction that
 * sends a reader to it.
 *
 * The instruction rather than a command word, because the doors do not take the
 * same flags: `queue` has no `--run` at all — re-running it IS the resume path.
 * `<id>` is substituted with the run's own.
 *
 * Direct runs are no longer sent anywhere: this door continues them, in the
 * workspace they recorded, from whichever stage they stopped in.
 */
const resumeCommandByPipeline: Record<PipelineKind, string | undefined> = {
	[PipelineKind.Implement]: undefined,
	[PipelineKind.Phases]: undefined,
	[PipelineKind.Refactor]: 'lightsout refactor --run <id>',
	[PipelineKind.Coverage]: 'lightsout test-coverage-to-threshold --run <id>',
	[PipelineKind.Queue]: 'lightsout queue (a restart resumes parked tickets first)',
	[PipelineKind.Direct]: undefined,
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

	// A direct run is the one exception. `passed` there means the build and the
	// gates are done while the commit or the ship is not, and repeating the build
	// would spend a model on finished work — so it is resumable, from the commit.
	if (manifest.status === RunStatus.Passed && pipeline !== PipelineKind.Direct) {
		console.error(`run ${manifest.runId} already passed — nothing to resume`);
		return exitCli({ code: 1 });
	}

	return { manifest, pipeline };
};

/** The pipeline that continues this run, each given the workspace its source work happens in. */
const runResumedPipeline = ({
	pipeline,
	cwd,
	workspace,
	driver,
	config,
	generated,
	willShip,
	resumable,
	skipRefactor,
}: {
	pipeline: PipelineKind;
	cwd: string;
	workspace: string;
	driver: Driver;
	config: LightsoutConfig;
	generated: string[] | undefined;
	willShip: boolean;
	resumable: RunManifest;
	skipRefactor: boolean;
}) => {
	if (pipeline === PipelineKind.Direct) {
		return continueDirectRun({ cwd, workspace, manifest: resumable, config, driver, generated, willShip });
	}

	const params = { cwd: workspace, driver, config, existing: resumable, skipRefactor, onProgress: createProgressPrinter() };

	return pipeline === PipelineKind.Phases ? runPhasesOrFailFast(params) : runPipelineOrFailFast(params);
};

/**
 * The run, the driver and the config this continuation goes on with.
 *
 * The ship intent is restamped rather than assumed, because it is resolved
 * fresh for every invocation: the parked run may have carried `--no-ship`, or
 * the config may have gained `after-implement` since. The field means exactly
 * what it says — this run, in this process, will ship — so the progress view
 * draws a ship row when one is coming and none when it is not.
 *
 * Resume truth is the manifest's recorded harness, never the config (decision
 * 6); the implement entry's model applies only when it targets that same
 * harness, while effort applies unconditionally because it is harness-neutral.
 */
const prepareResumedRun = async ({ cwd, manifest, loaded, willShip }: { cwd: string; manifest: RunManifest; loaded: LightsoutConfig; willShip: boolean }) => {
	const resumable = (manifest.willShip === true) === willShip ? manifest : await writeRunManifest({ cwd, manifest: { ...manifest, willShip } });
	const resolved = resolveCommandHarness({ config: loaded, command: 'implement' });
	const config = {
		...loaded,
		harness: manifest.harness,
		model: resolved.driverName === manifest.harness ? resolved.model : undefined,
		effort: resolved.effort,
	};

	return { resumable, config, driver: getDriver({ name: manifest.harness }) };
};

export const resumeCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const skipRefactor = flags.get('skip-refactor') === true;
	const { manifest, pipeline } = await readResumableRun({ cwd, flags });
	// Before the config, the guard and the restamp: a run whose recorded workspace
	// has gone must say so rather than quietly rebuild in the checkout the command
	// was launched from, and nothing should have been mutated by the time it does.
	const located = await resolveRunCwd({ cwd, manifest });

	if ('error' in located) {
		console.error(located.error);
		return exitCli({ code: 1 });
	}

	const workspace = located.workspace;
	const loaded = await readConfig({ cwd });

	// A resumed run ships on the same terms a first run does: whatever the
	// config and the flags say, settled here rather than inherited. A fix, a
	// resume and a merge is the whole point of parking, and a run that had to be
	// resumed is not a run that deserves to end unshipped and unmentioned.
	const shipIntent = resolveCommandShipIntent({ config: loaded, flags, env: process.env });

	if (shipIntent === undefined) {
		return exitCli({ code: 1 });
	}

	// Every pipeline still here writes source, so each owes the pre-source
	// lifecycle write the implement entries already make. It is also what refuses
	// a ticket under a gate hold, and it runs before the restamp below so a
	// refused resume mutates nothing. It is asked of the WORKSPACE, because the
	// branch it reads the ticket from is the one the run is building on. No
	// `ticketRef`: a resumed run is ticket-backed through its branch, which the
	// guard reads for itself.
	const refusal = await requireImplementLifecycle({ cwd: workspace, config: loaded, env: process.env, onProgress: createProgressPrinter() });

	if (refusal !== undefined) {
		console.error(refusal);
		return exitCli({ code: 1 });
	}

	const { resumable, config, driver } = await prepareResumedRun({ cwd, manifest, loaded, willShip: shipIntent.willShip });

	console.log(`lightsout: resuming run ${manifest.runId} (was: ${manifest.status}, plan: ${manifest.plan})`);
	printRunHeader({ config, driver, cwd });

	// Everything that touches source acts on the workspace; only the run's own
	// records stay in the checkout the command was launched from.
	const result = await runResumedPipeline({
		pipeline,
		cwd,
		workspace,
		driver,
		config,
		generated: loaded.generated,
		willShip: shipIntent.willShip,
		resumable,
		skipRefactor,
	});

	await printResult({ result, cwd });
	return exitAfterImplement({
		config: loaded,
		cwd: workspace,
		result,
		shipFlag: flags.get('ship') === true,
		noShipFlag: flags.get('no-ship') === true,
		env: process.env,
	});
};
