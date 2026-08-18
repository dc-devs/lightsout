import { getStringFlag } from '@/cli/common/args/getStringFlag';
import { printRefactorResult } from '@/cli/common/render/printRefactorResult';
import type { CommandContext } from '@/cli/common/types/CommandContext';
import { createProgressPrinter } from '@/cli/common/utils/createProgressPrinter';
import { resolveCommandHarness } from '@/cli/common/utils/resolveCommandHarness';
import { loadConfig } from '@/common/utils/loadConfig';
import { messageOf } from '@/common/utils/messageOf';
import type { RunManifest } from '@/contracts';
import { getDriver } from '@/drivers';
import { type RefactorResult, runRefactorPipeline } from '@/refactor';
import { RunLockError, readRunManifest } from '@/runState';

export const refactorCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const resumeRunId = getStringFlag({ flags, name: 'run' });
	const maxBatchesFlag = getStringFlag({ flags, name: 'max-batches' });

	// Unlike the standards check, refactor MUTATES code — a missing config (no
	// gates) is a hard error, never a fallback.
	const loaded = await loadConfig({ cwd });
	const { driverName, model, effort } = resolveCommandHarness({ config: loaded, command: 'refactor' });
	const driver = getDriver({ name: driverName });
	const config = { ...loaded, harness: driverName, model, effort };
	const maxBatches = maxBatchesFlag === undefined ? undefined : Number.parseInt(maxBatchesFlag, 10);

	if (maxBatches !== undefined && (!Number.isFinite(maxBatches) || maxBatches < 1)) {
		console.error(`--max-batches must be a positive integer, got '${maxBatchesFlag}'`);
		process.exit(1);
	}

	let existing: RunManifest | undefined;

	try {
		existing = resumeRunId ? await readRunManifest({ cwd, runId: resumeRunId }) : undefined;
	} catch (error) {
		// An unknown id says which id; a manifest that will not parse says that
		// instead, rather than being reported as a run that does not exist.
		console.error(messageOf({ error }));
		process.exit(1);
	}

	console.log(`lightsout: refactor ${existing ? `resuming run ${existing.runId}` : 'starting run'}`);

	let result: RefactorResult;

	try {
		result = await runRefactorPipeline({
			cwd,
			driver,
			config,
			path: getStringFlag({ flags, name: 'path' }),
			all: flags.get('all') === true,
			maxBatches,
			// The same flag the standards check takes: run against the deterministic
			// checks alone, skipping each batch's agent review.
			agentReview: flags.get('code-checks') !== true,
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
