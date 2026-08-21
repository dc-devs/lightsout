import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { usage } from '#src/cli/common/constants/usage.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { resolveConfigAndDriver } from '#src/cli/common/utils/resolveConfigAndDriver.ts';
import { PromptImprovementStatus } from '#src/common/constants/PromptImprovementStatus.ts';
import { WorkReportStatus } from '#src/contracts/index.ts';
import { runPromptImprovement } from '#src/runPromptImprovement.ts';

export const improveCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const engineCwd = getStringFlag({ flags, name: 'engine' });

	if (!engineCwd) {
		console.error(usage);
		return exitCli({ code: 1 });
	}

	const { config, driver } = await resolveConfigAndDriver({ cwd, command: 'improve' });
	const result = await runPromptImprovement({ consumerCwd: cwd, engineCwd, driver, model: config?.model, effort: config?.effort });

	if (result.status === PromptImprovementStatus.NoFriction) {
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

	return exitCli({ code: report.status === WorkReportStatus.Complete ? 0 : 1 });
};
