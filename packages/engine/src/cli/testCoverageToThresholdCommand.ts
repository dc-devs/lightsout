import { printCoverageResult } from '@/cli/common/render/printCoverageResult';
import type { CommandContext } from '@/cli/common/types/CommandContext';
import { createProgressPrinter } from '@/cli/common/utils/createProgressPrinter';
import { runBatchedCommand } from '@/cli/common/utils/runBatchedCommand';
import { runCoveragePipeline } from '@/coverage';

export const testCoverageToThresholdCommand = ({ flags, cwd }: CommandContext): Promise<void> =>
	runBatchedCommand({
		flags,
		cwd,
		command: 'test-coverage-to-threshold',
		print: printCoverageResult,
		run: ({ config, driver, maxBatches, existing }) =>
			runCoveragePipeline({ cwd, driver, config, maxBatches, allowDirty: flags.get('allow-dirty') === true, existing, onProgress: createProgressPrinter() }),
	});
