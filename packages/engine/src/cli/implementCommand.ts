import { getStringFlag } from '@/cli/common/args/getStringFlag';
import { usage } from '@/cli/common/constants/usage';
import { printResult } from '@/cli/common/render/printResult';
import { printRunHeader } from '@/cli/common/render/printRunHeader';
import type { CommandContext } from '@/cli/common/types/CommandContext';
import { createProgressPrinter } from '@/cli/common/utils/createProgressPrinter';
import { exitCli } from '@/cli/common/utils/exitCli';
import { resolveCommandHarness } from '@/cli/common/utils/resolveCommandHarness';
import { resolvePlanTarget } from '@/cli/common/utils/resolvePlanTarget';
import { runPhasesOrFailFast } from '@/cli/common/utils/runPhasesOrFailFast';
import { runPipelineOrFailFast } from '@/cli/common/utils/runPipelineOrFailFast';
import { loadConfig } from '@/common/utils/loadConfig';
import { getDriver } from '@/drivers';

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

	const loaded = await loadConfig({ cwd });
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
