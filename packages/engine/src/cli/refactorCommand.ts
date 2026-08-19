import { getStringFlag } from '@/cli/common/args/getStringFlag';
import { printRefactorResult } from '@/cli/common/render/printRefactorResult';
import type { CommandContext } from '@/cli/common/types/CommandContext';
import { createProgressPrinter } from '@/cli/common/utils/createProgressPrinter';
import { runBatchedCommand } from '@/cli/common/utils/runBatchedCommand';
import { runRefactorPipeline } from '@/refactor';

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
