import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { printRefactorResult } from '#src/cli/common/render/printRefactorResult.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { runBatchedCommand } from '#src/cli/common/utils/runBatchedCommand.ts';
import { runRefactorPipeline } from '#src/refactor/index.ts';

export const refactorCommand = ({ flags, cwd }: CommandContext): Promise<void> =>
	runBatchedCommand({
		flags,
		cwd,
		command: 'refactor',
		print: printRefactorResult,
		run: ({ config, driver, maxBatches, existing }) =>
			runRefactorPipeline({
				cwd,
				driver,
				config,
				path: getStringFlag({ flags, name: 'path' }),
				all: flags.get('all') === true,
				maxBatches,
				// The same flag the standards check takes: run against the deterministic
				// checks alone, skipping each batch's agent review.
				agentReview: flags.get('code-checks') !== true,
				allowDirty: flags.get('allow-dirty') === true,
				existing,
				onProgress: createProgressPrinter(),
			}),
	});
