import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { usage } from '#src/cli/common/constants/usage.ts';
import { printResult } from '#src/cli/common/render/printResult.ts';
import { printRunHeader } from '#src/cli/common/render/printRunHeader.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { resolveCommandHarness } from '#src/cli/common/utils/resolveCommandHarness.ts';
import { resolvePlanTarget } from '#src/cli/common/utils/resolvePlanTarget.ts';
import { runPhasesOrFailFast } from '#src/cli/common/utils/runPhasesOrFailFast.ts';
import { runPipelineOrFailFast } from '#src/cli/common/utils/runPipelineOrFailFast.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { getDriver } from '#src/drivers/index.ts';

export const implementCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const skipRefactor = flags.get('skip-refactor') === true;

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
		console.error(usage);
		return exitCli({ code: 1 });
	}

	const startPhase = startPhaseFlag === undefined ? undefined : Number.parseInt(startPhaseFlag, 10);

	if (startPhase !== undefined && (!Number.isFinite(startPhase) || startPhase < 1)) {
		console.error(`--start-phase must be a positive integer, got '${startPhaseFlag}'`);
		return exitCli({ code: 1 });
	}

	const target = await resolvePlanTarget({ cwd, planPath });

	if ('error' in target) {
		console.error(target.error);
		return exitCli({ code: 1 });
	}

	const phased = 'overviewPath' in target;

	if (phased && overviewPath !== undefined) {
		console.error('--overview applies to a single-plan run — a plan folder with an overview.md already runs every phase');
		return exitCli({ code: 1 });
	}

	if (phased && packages !== undefined) {
		console.error('--packages applies to a single-plan run — every phase of a plan folder reads its own scope');
		return exitCli({ code: 1 });
	}

	if (!phased && startPhase !== undefined) {
		console.error('--start-phase applies to a plan folder holding an overview.md — a single plan has one phase');
		return exitCli({ code: 1 });
	}

	const loaded = await readConfig({ cwd });
	const { driverName, model, effort } = resolveCommandHarness({ config: loaded, command: 'implement' });
	const driver = getDriver({ name: driverName });
	const config = { ...loaded, harness: driverName, model, effort };

	console.log(`lightsout: starting run`);
	console.log(
		'overviewPath' in target
			? `  overview: ${target.overviewPath}${startPhase === undefined ? '' : `\n  start phase: ${startPhase}`}`
			: `  plan: ${target.planPath}${overviewPath ? `\n  overview: ${overviewPath}` : ''}${packages ? `\n  packages flag: ${packages.join(', ')}` : ''}`,
	);
	printRunHeader({ config, driver, cwd });

	const result =
		'overviewPath' in target
			? await runPhasesOrFailFast({ cwd, driver, config, overviewPath: target.overviewPath, startPhase, skipRefactor, onProgress: createProgressPrinter() })
			: await runPipelineOrFailFast({
					cwd,
					planPath: target.planPath,
					overviewPath,
					packages,
					driver,
					config,
					skipRefactor,
					onProgress: createProgressPrinter(),
				});

	await printResult({ result, cwd });
	return exitCli({ code: result.ok ? 0 : 1 });
};
