import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { usage } from '#src/cli/common/constants/usage.ts';
import { finishImplementRun } from '#src/cli/common/implementRun/finishImplementRun.ts';
import { openImplementWorkspace } from '#src/cli/common/implementRun/openImplementWorkspace.ts';
import { printPlanTicketWarning } from '#src/cli/common/render/printPlanTicketWarning.ts';
import { printRunHeader } from '#src/cli/common/render/printRunHeader.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import type { PlanTarget } from '#src/cli/common/types/PlanTarget.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { ensurePlanWorkspace } from '#src/cli/common/utils/ensurePlanWorkspace.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { resolveCommandHarness } from '#src/cli/common/utils/resolveCommandHarness.ts';
import { resolveCommandShipIntent } from '#src/cli/common/utils/resolveCommandShipIntent.ts';
import { resolvePlanTarget } from '#src/cli/common/utils/resolvePlanTarget.ts';
import { runPhasesOrFailFast } from '#src/cli/common/utils/runPhasesOrFailFast.ts';
import { runPipelineOrFailFast } from '#src/cli/common/utils/runPipelineOrFailFast.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { type Driver, getDriver } from '#src/drivers/index.ts';
import { planNameFromPath } from '#src/plan/index.ts';
import { requireImplementLifecycle } from '#src/ticketLifecycle/index.ts';

/**
 * What the run's flags amount to once they have been read and checked against
 * each other, or the one message saying why they cannot amount to a run.
 *
 * The checks live together because none of them stands alone: whether
 * `--overview`, `--packages` and `--start-phase` are allowed depends on what
 * `--plan` turned out to point at, and the order is what makes the message name
 * the first real problem rather than a cascade.
 *
 * Every check here reads the LAUNCHING checkout, and every one of them runs
 * before a workspace is resolved: no worktree may be created for a flag
 * combination that is going to be refused.
 */
const resolveImplementInputs = async ({ flags, cwd }: { flags: CommandContext['flags']; cwd: string }) => {
	const planPath = getStringFlag({ flags, name: 'plan' });
	const overviewPath = getStringFlag({ flags, name: 'overview' });
	const packagesFlag = getStringFlag({ flags, name: 'packages' });
	const startPhaseFlag = getStringFlag({ flags, name: 'start-phase' });
	const packages = packagesFlag
		? packagesFlag
				.split(',')
				.map((name) => name.trim())
				.filter(Boolean)
		: undefined;

	if (!planPath) {
		return { error: usage };
	}

	const startPhase = startPhaseFlag === undefined ? undefined : Number.parseInt(startPhaseFlag, 10);

	if (startPhase !== undefined && (!Number.isFinite(startPhase) || startPhase < 1)) {
		return { error: `--start-phase must be a positive integer, got '${startPhaseFlag}'` };
	}

	// The fetch has to have happened before anything asks the disk what shape the
	// plan is.
	const ensured = await ensurePlanWorkspace({ cwd, planPath });

	if (ensured !== undefined) {
		return { error: ensured.error };
	}

	const target = await resolvePlanTarget({ cwd, planPath });

	if ('error' in target) {
		return { error: target.error };
	}

	const phased = 'overviewPath' in target;

	if (phased && overviewPath !== undefined) {
		return { error: '--overview applies to a single-plan run — a plan folder with an overview.md already runs every phase' };
	}

	if (phased && packages !== undefined) {
		return { error: '--packages applies to a single-plan run — every phase of a plan folder reads its own scope' };
	}

	if (!phased && startPhase !== undefined) {
		return { error: '--start-phase applies to a plan folder holding an overview.md — a single plan has one phase' };
	}

	return { planPath, overviewPath, packages, startPhase, planName: planNameFromPath({ cwd, planPath }) };
};

/** The pipeline the resolved plan target asks for: every phase of a folder holding an overview, or the one plan. */
const runResolvedPipeline = ({
	cwd,
	target,
	overviewPath,
	packages,
	startPhase,
	driver,
	config,
	skipRefactor,
	willShip,
}: {
	cwd: string;
	target: PlanTarget;
	overviewPath: string | undefined;
	packages: string[] | undefined;
	startPhase: number | undefined;
	driver: Driver;
	config: LightsoutConfig;
	skipRefactor: boolean;
	willShip: boolean;
}) =>
	'overviewPath' in target
		? runPhasesOrFailFast({
				cwd,
				driver,
				config,
				overviewPath: target.overviewPath,
				startPhase,
				skipRefactor,
				willShip,
				onProgress: createProgressPrinter(),
			})
		: runPipelineOrFailFast({
				cwd,
				planPath: target.planPath,
				overviewPath,
				packages,
				driver,
				config,
				skipRefactor,
				willShip,
				onProgress: createProgressPrinter(),
			});

export const implementCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const inputs = await resolveImplementInputs({ flags, cwd });

	if ('error' in inputs) {
		console.error(inputs.error);
		return exitCli({ code: 1 });
	}

	const { planPath, overviewPath, packages, startPhase, planName } = inputs;
	const skipRefactor = flags.get('skip-refactor') === true;
	const loaded = await readConfig({ cwd });
	const { driverName, model, effort } = resolveCommandHarness({ config: loaded, command: 'implement' });
	const driver = getDriver({ name: driverName });
	const config = { ...loaded, harness: driverName, model, effort };
	const shipIntent = resolveCommandShipIntent({ config: loaded, flags, env: process.env });

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

	if (planName !== undefined) {
		await printPlanTicketWarning({ cwd, name: planName });
	}

	console.log(`lightsout: starting run`);
	console.log(
		'overviewPath' in target
			? `  overview: ${target.overviewPath}${startPhase === undefined ? '' : `\n  start phase: ${startPhase}`}`
			: `  plan: ${target.planPath}${overviewPath ? `\n  overview: ${overviewPath}` : ''}${packages ? `\n  packages flag: ${packages.join(', ')}` : ''}`,
	);
	printRunHeader({ config, driver, cwd: workspace.cwd });

	const result = await runResolvedPipeline({
		cwd: workspace.cwd,
		target,
		overviewPath,
		packages,
		startPhase,
		driver,
		config,
		skipRefactor,
		willShip: shipIntent.willShip,
	});

	return finishImplementRun({ config: loaded, cwd: workspace.cwd, result, flags });
};
