import { RunStatus } from '@/contracts';
import { getDriver } from '@/drivers';
import { loadConfig } from '@/common/utils/loadConfig';
import { readRunManifest, RunNotFoundError } from '@/runState';
import { getStringFlag } from '@/cli/common/args/getStringFlag';
import { usage } from '@/cli/common/constants/usage';
import { printResult } from '@/cli/common/render/printResult';
import { printRunHeader } from '@/cli/common/render/printRunHeader';
import { createProgressPrinter } from '@/cli/common/utils/createProgressPrinter';
import { resolveCommandHarness } from '@/cli/common/utils/resolveCommandHarness';
import { runPipelineOrFailFast } from '@/cli/common/utils/runPipelineOrFailFast';
import type { CommandContext } from '@/cli/common/types/CommandContext';

export const resumeCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const skipRefactor = flags.get('skip-refactor') === true;

	const runId = getStringFlag({ flags, name: 'run' });

	if (!runId) {
		console.error(usage);
		process.exit(1);
	}

	// A run id the user typed is theirs to get wrong: an unknown one is a
	// message, never the stack of the manifest path we tried to open.
	const manifest = await readRunManifest({ cwd, runId }).catch((error: unknown) => {
		if (error instanceof RunNotFoundError) {
			console.error(error.message);
			process.exit(1);
		}

		throw error;
	});

	if ((manifest.pipeline ?? 'implement') !== 'implement') {
		console.error(
			`run ${manifest.runId} belongs to the ${manifest.pipeline} pipeline — resume it with: lightsout refactor --run ${manifest.runId}`,
		);
		process.exit(1);
	}

	if (manifest.status === RunStatus.Passed) {
		console.error(`run ${manifest.runId} already passed — nothing to resume`);
		process.exit(1);
	}

	const loaded = await loadConfig({ cwd });
	const resolved = resolveCommandHarness({ config: loaded, command: 'implement' });
	const driver = getDriver({ name: manifest.harness });
	// Resume truth is the manifest's recorded harness, never the config (decision 6);
	// the implement entry's model applies only when it targets that same harness,
	// while effort applies unconditionally because it is harness-neutral.
	const config = {
		...loaded,
		harness: manifest.harness,
		model: resolved.driverName === manifest.harness ? resolved.model : undefined,
		effort: resolved.effort,
	};

	console.log(`lightsout: resuming run ${manifest.runId} (was: ${manifest.status}, plan: ${manifest.plan})`);
	printRunHeader({ config, driver, cwd });

	const result = await runPipelineOrFailFast({
		cwd,
		driver,
		config,
		existing: manifest,
		skipRefactor,
		onProgress: createProgressPrinter(),
	});

	await printResult({ result, cwd });
	process.exit(result.ok ? 0 : 1);
};
