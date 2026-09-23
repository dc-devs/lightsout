import { finishImplementRun } from '#src/cli/common/implementRun/finishImplementRun.ts';
import { openImplementWorkspace } from '#src/cli/common/implementRun/openImplementWorkspace.ts';
import { reportWorkOrderPlanOutcome } from '#src/cli/common/implementRun/reportWorkOrderPlanOutcome.ts';
import { resolveImplementInputs } from '#src/cli/common/implementRun/resolveImplementInputs.ts';
import { printRunStart } from '#src/cli/common/render/printRunStart.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import type { PlanTarget } from '#src/cli/common/types/PlanTarget.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { resolveCommandHarness } from '#src/cli/common/utils/resolveCommandHarness.ts';
import { resolveCommandShipIntent } from '#src/cli/common/utils/resolveCommandShipIntent.ts';
import { runPhasesOrFailFast } from '#src/cli/common/utils/runPhasesOrFailFast.ts';
import { runPipelineOrFailFast } from '#src/cli/common/utils/runPipelineOrFailFast.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { type Driver, getDriver } from '#src/drivers/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import { recordPlanCommandRun } from '#src/plan/index.ts';
import { requireImplementLifecycle } from '#src/ticketLifecycle/index.ts';
import { runWorkOrderPlanLifecycle } from '#src/workOrder/index.ts';

/**
 * The pipeline the resolved plan target asks for — every phase of a folder
 * holding an overview, or the one plan — inside the ONE command run this
 * invocation records, written to the plan folder of the LAUNCHING checkout
 * `cwd` names while the source work happens in `workspace`. That is why the
 * record is opened here and not in a pipeline a phased plan calls once per
 * phase; a plan outside the plans directory has no name, and so no folder.
 */
const runResolvedPipeline = ({
	cwd,
	workspace,
	planName,
	target,
	overviewPath,
	packages,
	startPhase,
	runId,
	driver,
	config,
	skipRefactor,
	willShip,
}: {
	cwd: string;
	workspace: string;
	planName: string | undefined;
	target: PlanTarget;
	overviewPath: string | undefined;
	packages: string[] | undefined;
	startPhase: number | undefined;
	/** The id the run is created under, minted before it started so the ticket record can name it. */
	runId: string;
	driver: Driver;
	config: LightsoutConfig;
	skipRefactor: boolean;
	willShip: boolean;
}) =>
	// Written out because inferring it would be circular: `work`'s own parameter is typed from it.
	recordPlanCommandRun<PipelineResult>({
		cwd,
		name: planName,
		label: 'implement',
		statusOf: ({ result }) => result.manifest.status,
		work: ({ level }) =>
			'overviewPath' in target
				? runPhasesOrFailFast({
						cwd: workspace,
						driver,
						config,
						overviewPath: target.overviewPath,
						startPhase,
						runId,
						skipRefactor,
						willShip,
						level,
						onProgress: createProgressPrinter(),
					})
				: runPipelineOrFailFast({
						cwd: workspace,
						planPath: target.planPath,
						overviewPath,
						packages,
						runId,
						driver,
						config,
						skipRefactor,
						willShip,
						level,
						onProgress: createProgressPrinter(),
					}),
	});

export const implementCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const inputs = await resolveImplementInputs({ flags, cwd });

	if ('error' in inputs) {
		console.error(inputs.error);
		return exitCli({ code: 1 });
	}

	const { planPath, overviewPath, packages, startPhase, planName, shipRequest } = inputs;
	const skipRefactor = flags.get('skip-refactor') === true;
	const loaded = await readConfig({ cwd });
	const { driverName, model, effort } = resolveCommandHarness({ config: loaded, command: 'implement' });
	const driver = getDriver({ name: driverName });
	const config = { ...loaded, harness: driverName, model, effort };
	const shipIntent = resolveCommandShipIntent({ config: loaded, flags, env: process.env, shipRequest });

	if (shipIntent === undefined) {
		return exitCli({ code: 1 });
	}

	const opened = await openImplementWorkspace({ cwd, config: loaded, flags, planPath });

	if ('error' in opened) {
		console.error(opened.error);
		return exitCli({ code: 1 });
	}

	const { workspace, target } = opened;

	// Before the pipeline, because the whole guarantee is that the ticket records
	// what it owes and that implementation has begun before an agent touches any
	// source. There is no `--ref`: implement builds whatever branch the workspace
	// holds, so the branch's own ticket reference is the one this reads, and a
	// branch carrying none proceeds untouched.
	const refused = await requireImplementLifecycle({ cwd: workspace.cwd, config: loaded, env: process.env, onProgress: createProgressPrinter() });

	if (refused !== undefined) {
		console.error(refused);
		return exitCli({ code: 1 });
	}

	printRunStart({ target, overviewPath, packages, startPhase, config, driver, cwd: workspace.cwd });

	// The record's own bookkeeping around the run: the plan is marked implementing
	// under the id the pipeline is handed, and the outcome is recorded against it.
	// A legacy folder and a ticket with no record run exactly as they always have.
	const outcome = await runWorkOrderPlanLifecycle({
		cwd: workspace.cwd,
		name: planName,
		run: ({ runId }) =>
			runResolvedPipeline({
				cwd,
				workspace: workspace.cwd,
				planName,
				target,
				overviewPath,
				packages,
				startPhase,
				runId,
				driver,
				config,
				skipRefactor,
				willShip: shipIntent.willShip,
			}),
	});

	const result = reportWorkOrderPlanOutcome({ outcome });

	if (result === undefined) {
		return exitCli({ code: 1 });
	}

	return finishImplementRun({ config: loaded, cwd: workspace.cwd, result, flags });
};
