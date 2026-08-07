import { runPromptImprovement } from '@/runPromptImprovement';
import { getStringFlag } from '@/cli/common/args/getStringFlag';
import { usage } from '@/cli/common/constants/usage';
import type { CommandContext } from '@/cli/common/types/CommandContext';
import { resolveConfigAndDriver } from '@/cli/common/utils/resolveConfigAndDriver';

export const improveCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const engineCwd = getStringFlag({ flags, name: 'engine' });

	if (!engineCwd) {
		console.error(usage);
		process.exit(1);
	}

	const { config, driver } = await resolveConfigAndDriver({ cwd, command: 'improve' });
	const result = await runPromptImprovement({ consumerCwd: cwd, engineCwd, driver, model: config?.model, effort: config?.effort });

	if (result.status === 'no-friction') {
		console.log('no friction recorded — nothing to improve from');
		process.exit(0);
	}

	if (!result.outcome.ok) {
		console.error(result.outcome.failure);
		process.exit(1);
	}

	const { report } = result.outcome;

	console.log(`\nimprove: ${report.status} (${result.friction.length} friction entries considered)`);
	console.log(`  ${report.summary}`);

	for (const file of report.changedFiles) {
		console.log(`  ~ ${file.path} — ${file.summary}`);
	}

	if (report.changedFiles.length > 0) {
		console.log(`\nreview the diff in ${engineCwd} — the loop proposes, a human ships.`);
	}

	process.exit(report.status === 'complete' ? 0 : 1);
};
