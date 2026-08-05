import { RunStatus } from '@/contracts';
import { getDriver } from '@/drivers';
import { loadConfig } from '@/common/utils/loadConfig';
import { runRefactorPipeline } from '@/refactor';
import { readRunManifest, RunLockError } from '@/runState';
import { getStringFlag } from '@/cli/common/args/getStringFlag';
import { bold } from '@/cli/common/terminal/bold';
import { dim } from '@/cli/common/terminal/dim';
import { green } from '@/cli/common/terminal/green';
import { red } from '@/cli/common/terminal/red';
import { yellow } from '@/cli/common/terminal/yellow';
import type { CommandContext } from '@/cli/common/types/CommandContext';
import { createProgressPrinter } from '@/cli/common/utils/createProgressPrinter';
import { resolveCommandHarness } from '@/cli/common/utils/resolveCommandHarness';

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

		console.error(`\n${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}

	const { manifest, declined, before, after } = result;
	const batchSteps = manifest.steps.filter((step) => step.id.startsWith('batch-'));

	const statusLabel = result.ok && declined.length > 0 ? `${manifest.status.toUpperCase()} · ${declined.length} declined` : manifest.status.toUpperCase();

	console.log(`\n${bold(`refactor ${manifest.runId.slice(0, 8)}`)} — ${statusLabel}`);

	for (const step of batchSteps) {
		const decline = declined.find((entry) => entry.batchId === step.id);
		const icon = step.status !== RunStatus.Passed ? red('✗') : decline ? yellow('⤫') : green('✓');
		const label = decline ? `declined (${decline.remainingClusters.length} cluster(s) persist)` : step.status === RunStatus.Passed ? 'resolved' : step.status;

		console.log(`${icon} ${step.id.padEnd(48)}${label}${step.changedFiles?.length ? dim(` · ${step.changedFiles.length} file(s)`) : ''}`);
	}

	for (const entry of declined) {
		console.log(`\n${yellow('declined')} ${entry.batchId}`);

		for (const line of entry.rationale) {
			console.log(dim(`  ${line}`));
		}

		console.log(dim(`  review each cluster — fix by hand, or accept it as debt: lightsout scan --baseline`));
	}

	const detectors = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();

	// A parked run takes no final scan — its `after` merely echoes `before`,
	// and printing that as a burn-down reads as "nothing improved".
	if (!result.ok) {
		console.log(dim(`\nno burn-down until the run completes — resume to finish and measure`));
	} else if (detectors.length > 0) {
		console.log(`\nburn-down (findings before → after):`);

		for (const detector of detectors) {
			console.log(`  ${detector.padEnd(20)}${before[detector] ?? 0} → ${after[detector] ?? 0}`);
		}
	}

	if (manifest.changedFiles.length > 0) {
		console.log(`\n${manifest.changedFiles.length} file(s) changed in the working tree — review and commit; the engine never commits.`);
	}

	console.log(`evidence: .lightsout/runs/${manifest.runId}/`);

	if (!result.ok && result.error) {
		console.error(`\n${result.error}`);
	}

	process.exit(result.ok ? 0 : 1);
};
