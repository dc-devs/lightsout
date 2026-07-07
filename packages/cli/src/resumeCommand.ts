import { RunStatus } from '@lightsout/contracts';
import { getDriver } from '@lightsout/drivers';
import { loadConfig, readRunManifest } from '@lightsout/engine';
import { getStringFlag } from './common/args/getStringFlag';
import { usage } from './common/constants/usage';
import { printResult } from './common/render/printResult';
import { printRunHeader } from './common/render/printRunHeader';
import { createProgressPrinter } from './common/utils/createProgressPrinter';
import { runPipelineOrFailFast } from './common/utils/runPipelineOrFailFast';
import type { CommandContext } from './common/types/CommandContext';

export const resumeCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const skipRefactor = flags.get('skip-refactor') === true;

	const runId = getStringFlag({ flags, name: 'run' });

	if (!runId) {
		console.error(usage);
		process.exit(1);
	}

	const manifest = await readRunManifest({ cwd, runId });

	if ((manifest.pipeline ?? 'implement') !== 'implement') {
		console.error(`run ${runId} belongs to the ${manifest.pipeline} pipeline — resume it with: lightsout refactor --run ${runId}`);
		process.exit(1);
	}

	if (manifest.status === RunStatus.Passed) {
		console.error(`run ${runId} already passed — nothing to resume`);
		process.exit(1);
	}

	const config = await loadConfig({ cwd });
	const driver = getDriver({ name: manifest.driver });

	console.log(`lightsout: resuming run ${runId} (was: ${manifest.status}, plan: ${manifest.plan})`);
	printRunHeader({ config, driver, cwd });

	const result = await runPipelineOrFailFast({
		cwd,
		driver,
		config,
		existing: manifest,
		skipRefactor,
		onProgress: createProgressPrinter(),
	});

	await printResult({ result, cwd });
	process.exit(result.ok ? 0 : 1);
};
