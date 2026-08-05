import { runPromptImprovement } from '@lightsout/engine';
import { getStringFlag } from './common/args/getStringFlag';
import { usage } from './common/constants/usage';
import type { CommandContext } from './common/types/CommandContext';
import { resolveConfigAndDriver } from './common/utils/resolveConfigAndDriver';

export const improveCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const engineCwd = getStringFlag({ flags, name: 'engine' });

	if (!engineCwd) {
		console.error(usage);
		process.exit(1);
	}

	const { config, driver } = await resolveConfigAndDriver({ cwd, command: 'improve' });
	const result = await runPromptImprovement({ consumerCwd: cwd, engineCwd, driver, model: config?.model, effort: config?.effort });

	if (result.friction.length === 0) {
		console.log('no friction recorded — nothing to improve from');
		process.exit(0);
	}

	if (result.rateLimited || !result.report) {
		console.error(result.failure ?? 'improver produced no valid report');
		process.exit(1);
	}

	console.log(`\nimprove: ${result.report.status} (${result.friction.length} friction entries considered)`);
	console.log(`  ${result.report.summary}`);

	for (const file of result.report.changedFiles) {
		console.log(`  ~ ${file.path} — ${file.summary}`);
	}

	if (result.report.changedFiles.length > 0) {
		console.log(`\nreview the diff in ${engineCwd} — the loop proposes, a human ships.`);
	}

	process.exit(result.report.status === 'complete' ? 0 : 1);
};
