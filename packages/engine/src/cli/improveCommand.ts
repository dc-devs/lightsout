import { getStringFlag } from '@/cli/common/args/getStringFlag';
import { usage } from '@/cli/common/constants/usage';
import type { CommandContext } from '@/cli/common/types/CommandContext';
import { exitCli } from '@/cli/common/utils/exitCli';
import { resolveConfigAndDriver } from '@/cli/common/utils/resolveConfigAndDriver';
import { runPromptImprovement } from '@/runPromptImprovement';

export const improveCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const engineCwd = getStringFlag({ flags, name: 'engine' });

	if (!engineCwd) {
		console.error(usage);
		return exitCli({ code: 1 });
	}

	const { config, driver } = await resolveConfigAndDriver({ cwd, command: 'improve' });
	const result = await runPromptImprovement({ consumerCwd: cwd, engineCwd, driver, model: config?.model, effort: config?.effort });

	if (result.status === 'no-friction') {
		console.log('no friction recorded — nothing to improve from');
		return exitCli({ code: 0 });
	}

	if (!result.outcome.ok) {
		console.error(result.outcome.failure);
		return exitCli({ code: 1 });
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

	return exitCli({ code: report.status === 'complete' ? 0 : 1 });
};
