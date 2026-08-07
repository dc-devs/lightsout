import { getDriver } from '@/drivers';
import { loadConfig } from '@/common/utils/loadConfig';
import { runRefactorPipeline } from '@/refactor';
import { readRunManifest, RunLockError } from '@/runState';
import { getStringFlag } from '@/cli/common/args/getStringFlag';
import { printRefactorResult } from '@/cli/common/render/printRefactorResult';
import type { CommandContext } from '@/cli/common/types/CommandContext';
import { createProgressPrinter } from '@/cli/common/utils/createProgressPrinter';
import { resolveCommandHarness } from '@/cli/common/utils/resolveCommandHarness';
import { messageOf } from '@/common/utils/messageOf';

export const refactorCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const resumeRunId = getStringFlag({ flags, name: 'run' });
	const maxBatchesFlag = getStringFlag({ flags, name: 'max-batches' });

	// Unlike scan, refactor MUTATES code — a missing config (no gates) is a
	// hard error, never a fallback.
	const loaded = await loadConfig({ cwd });
	const { driverName, model, effort } = resolveCommandHarness({ config: loaded, command: 'refactor' });
	const driver = getDriver({ name: driverName });
	const config = { ...loaded, harness: driverName, model, effort };
	const maxBatches = maxBatchesFlag === undefined ? undefined : Number.parseInt(maxBatchesFlag, 10);

	if (maxBatches !== undefined && (!Number.isFinite(maxBatches) || maxBatches < 1)) {
		console.error(`--max-batches must be a positive integer, got '${maxBatchesFlag}'`);
		process.exit(1);
	}

	let existing;

	try {
		existing = resumeRunId ? await readRunManifest({ cwd, runId: resumeRunId }) : undefined;
	} catch {
		console.error(`no run found for --run ${resumeRunId}`);
		process.exit(1);
	}

	console.log(`lightsout: refactor ${resumeRunId ? `resuming run ${resumeRunId}` : 'starting run'}`);

	let result;

	try {
		result = await runRefactorPipeline({
			cwd,
			driver,
			config,
			path: getStringFlag({ flags, name: 'path' }),
			all: flags.get('all') === true,
			maxBatches,
			existing,
			onProgress: createProgressPrinter(),
		});
	} catch (error) {
		if (error instanceof RunLockError) {
			console.error(`\n${error.message}`);
			process.exit(1);
		}

		console.error(`\n${messageOf({ error })}`);
		process.exit(1);
	}

	printRefactorResult({ result });

	process.exit(result.ok ? 0 : 1);
};
