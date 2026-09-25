import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { printCoverageResult } from '#src/cli/internal/common/render/printCoverageResult.ts';
import { createProgressPrinter } from '#src/cli/internal/common/utils/createProgressPrinter.ts';
import { runBatchedCommand } from '#src/cli/internal/common/utils/runBatchedCommand.ts';
import { runCoveragePipeline } from '#src/coverage/runCoveragePipeline.ts';

export const testCoverageToThresholdCommand = ({ flags, cwd }: CommandContext): Promise<void> =>
	runBatchedCommand({
		flags,
		cwd,
		command: 'test-coverage-to-threshold',
		print: printCoverageResult,
		run: ({ config, driver, maxBatches, existing }) =>
			runCoveragePipeline({ cwd, driver, config, maxBatches, allowDirty: flags.get('allow-dirty') === true, existing, onProgress: createProgressPrinter() }),
	});
