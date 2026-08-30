import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { usage } from '#src/cli/common/constants/usage.ts';
import { printPlanTicketWarning } from '#src/cli/common/render/printPlanTicketWarning.ts';
import { printResult } from '#src/cli/common/render/printResult.ts';
import { printRunHeader } from '#src/cli/common/render/printRunHeader.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitAfterImplement } from '#src/cli/common/utils/exitAfterImplement.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { resolveCommandHarness } from '#src/cli/common/utils/resolveCommandHarness.ts';
import { resolveCommandShipIntent } from '#src/cli/common/utils/resolveCommandShipIntent.ts';
import { resolvePlanTarget } from '#src/cli/common/utils/resolvePlanTarget.ts';
import { runPhasesOrFailFast } from '#src/cli/common/utils/runPhasesOrFailFast.ts';
import { runPipelineOrFailFast } from '#src/cli/common/utils/runPipelineOrFailFast.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { getDriver } from '#src/drivers/index.ts';
import { planNameFromPath } from '#src/plan/index.ts';

/**
 * What the run's flags amount to once they have been read and checked against
 * each other, or the one message saying why they cannot amount to a run.
 *
 * The checks live together because none of them stands alone: whether
 * `--overview`, `--packages` and `--start-phase` are allowed depends on what
 * `--plan` turned out to point at, and the order is what makes the message name
 * the first real problem rather than a cascade.
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

	return { target, overviewPath, packages, startPhase, planName: planNameFromPath({ cwd, planPath }) };
};

export const implementCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const inputs = await resolveImplementInputs({ flags, cwd });

	if ('error' in inputs) {
		console.error(inputs.error);
		return exitCli({ code: 1 });
	}

	const { target, overviewPath, packages, startPhase, planName } = inputs;
	const skipRefactor = flags.get('skip-refactor') === true;
	const loaded = await readConfig({ cwd });
	const { driverName, model, effort } = resolveCommandHarness({ config: loaded, command: 'implement' });
	const driver = getDriver({ name: driverName });
	const config = { ...loaded, harness: driverName, model, effort };
	const shipIntent = resolveCommandShipIntent({ config: loaded, flags, env: process.env });

	if (shipIntent === undefined) {
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
	printRunHeader({ config, driver, cwd });

	const result =
		'overviewPath' in target
			? await runPhasesOrFailFast({
					cwd,
					driver,
					config,
					overviewPath: target.overviewPath,
					startPhase,
					skipRefactor,
					willShip: shipIntent.willShip,
					onProgress: createProgressPrinter(),
				})
			: await runPipelineOrFailFast({
					cwd,
					planPath: target.planPath,
					overviewPath,
					packages,
					driver,
					config,
					skipRefactor,
					willShip: shipIntent.willShip,
					onProgress: createProgressPrinter(),
				});

	await printResult({ result, cwd });
	return exitAfterImplement({ config: loaded, cwd, result, shipFlag: flags.get('ship') === true, noShipFlag: flags.get('no-ship') === true, env: process.env });
};
