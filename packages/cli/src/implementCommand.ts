import { join } from 'node:path';
import { getDriver } from '@lightsout/drivers';
import { loadConfig } from '@lightsout/engine';
import { getStringFlag } from './common/args/getStringFlag';
import { usage } from './common/constants/usage';
import { printResult } from './common/render/printResult';
import { printRunHeader } from './common/render/printRunHeader';
import { createProgressPrinter } from './common/utils/createProgressPrinter';
import { runPipelineOrFailFast } from './common/utils/runPipelineOrFailFast';
import type { CommandContext } from './common/types/CommandContext';

export const implementCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const skipRefactor = flags.get('skip-refactor') === true;

	const planPath = getStringFlag({ flags, name: 'plan' });
	const overviewPath = getStringFlag({ flags, name: 'overview' });
	const packagesFlag = getStringFlag({ flags, name: 'packages' });
	const packages = packagesFlag
		? packagesFlag
				.split(',')
				.map((name) => name.trim())
				.filter(Boolean)
		: undefined;

	if (!planPath) {
		console.error(usage);
		process.exit(1);
	}

	const config = await loadConfig({ cwd });
	const driver = getDriver({ name: config.driver ?? 'claude-code' });

	console.log(`lightsout: starting run`);
	console.log(`  plan: ${planPath}${overviewPath ? `\n  overview: ${overviewPath}` : ''}${packages ? `\n  packages flag: ${packages.join(', ')}` : ''}`);
	printRunHeader({ config, driver, cwd });

	const result = await runPipelineOrFailFast({
		cwd,
		planPath,
		overviewPath,
		packages,
		driver,
		config,
		skipRefactor,
		onProgress: createProgressPrinter(),
	});

	await printResult({ result, cwd });
	process.exit(result.ok ? 0 : 1);
};
