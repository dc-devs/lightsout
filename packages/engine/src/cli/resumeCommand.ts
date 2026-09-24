import type { ActivityLevel } from '#src/activity/index.ts';
import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { usage } from '#src/cli/common/constants/usage.ts';
import { continueDirectRun } from '#src/cli/common/implementRun/continueDirectRun.ts';
import { readResumeClearance } from '#src/cli/common/implementRun/readResumeClearance.ts';
import { reportWorkOrderPlanOutcome } from '#src/cli/common/implementRun/reportWorkOrderPlanOutcome.ts';
import { resolveRunCwd } from '#src/cli/common/implementRun/resolveRunCwd.ts';
import { printResult } from '#src/cli/common/render/printResult.ts';
import { printRunHeader } from '#src/cli/common/render/printRunHeader.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitAfterImplement } from '#src/cli/common/utils/exitAfterImplement.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { resolveCommandHarness } from '#src/cli/common/utils/resolveCommandHarness.ts';
import { runPhasesOrFailFast } from '#src/cli/common/utils/runPhasesOrFailFast.ts';
import { runPipelineOrFailFast } from '#src/cli/common/utils/runPipelineOrFailFast.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { resolveConfigPath } from '#src/common/config/resolveConfigPath.ts';
import { type LightsoutConfig, PipelineKind, type RunManifest, RunStatus } from '#src/contracts/index.ts';
import { type Driver, getDriver } from '#src/drivers/index.ts';
import { recordPlanCommandRun } from '#src/plan/index.ts';
import { RunNotFoundError, readRunManifest, writeRunManifest } from '#src/runState/index.ts';
import { runWorkOrderPlanLifecycle } from '#src/workOrder/index.ts';

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
	willShip,
	resumable,
	skipRefactor,
	level,
}: {
	pipeline: PipelineKind;
	cwd: string;
	workspace: string;
	driver: Driver;
	config: LightsoutConfig;
	willShip: boolean;
	resumable: RunManifest;
	skipRefactor: boolean;
	/** The command-run level this continuation's work hangs from, or undefined when nothing is being recorded. */
	level: ActivityLevel | undefined;
}) => {
	if (pipeline === PipelineKind.Direct) {
		return continueDirectRun({ cwd, workspace, manifest: resumable, config, driver, willShip });
	}

	const params = { cwd: workspace, driver, config, existing: resumable, skipRefactor, level, onProgress: createProgressPrinter() };

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
	// Before the tracker write and before the ship restamp, so a resume nothing
	// will let happen mutates nothing on the way to saying so.
	const clearance = await readResumeClearance({ workspace, manifest, loaded, flags });

	if (clearance === undefined) {
		return exitCli({ code: 1 });
	}

	const { name, shipIntent } = clearance;
	const { resumable, config, driver } = await prepareResumedRun({ cwd, manifest, loaded, willShip: shipIntent.willShip });

	console.log(`lightsout: resuming run ${manifest.runId} (was: ${manifest.status}, plan: ${manifest.plan})`);
	printRunHeader({ config, driver, cwd, configPath: resolveConfigPath({ cwd }) });

	// Everything that touches source acts on the workspace; only the run's own
	// records stay in the checkout the command was launched from.
	//
	// The continuation is one more command run under the plan node the first run
	// wrote — a root level's id IS its label, so no second plan level is opened
	// and neither process has to read the record to find the other. A DIRECT run
	// records nothing: its plan path is a frozen ticket body, and the direct
	// pipeline is outside this record's scope even where the ticket record can
	// still answer a plan address for it.
	const outcome = await runWorkOrderPlanLifecycle({
		cwd: workspace,
		name,
		resumeRunId: manifest.runId,
		run: () =>
			recordPlanCommandRun({
				cwd,
				name: pipeline === PipelineKind.Direct ? undefined : name,
				label: 'resume',
				statusOf: ({ result }) => result.manifest.status,
				work: ({ level }) =>
					runResumedPipeline({
						pipeline,
						cwd,
						workspace,
						driver,
						config,
						willShip: shipIntent.willShip,
						resumable,
						skipRefactor,
						level,
					}),
			}),
	});

	const result = reportWorkOrderPlanOutcome({ outcome });

	if (result === undefined) {
		return exitCli({ code: 1 });
	}

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
