import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { usage } from '#src/cli/common/constants/usage.ts';
import { printResult } from '#src/cli/common/render/printResult.ts';
import { printRunHeader } from '#src/cli/common/render/printRunHeader.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { exitForRunResult } from '#src/cli/common/utils/exitForRunResult.ts';
import { resolveCommandHarness } from '#src/cli/common/utils/resolveCommandHarness.ts';
import { runPhasesOrFailFast } from '#src/cli/common/utils/runPhasesOrFailFast.ts';
import { runPipelineOrFailFast } from '#src/cli/common/utils/runPipelineOrFailFast.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { RunStatus } from '#src/contracts/index.ts';
import { getDriver } from '#src/drivers/index.ts';
import { RunNotFoundError, readRunManifest } from '#src/runState/index.ts';

/** Pipelines that own their own resume door — `lightsout resume` sends them back to it. */
const resumeCommandByPipeline: Record<string, string | undefined> = { refactor: 'refactor', coverage: 'test-coverage-to-threshold' };

export const resumeCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const skipRefactor = flags.get('skip-refactor') === true;

	const runId = getStringFlag({ flags, name: 'run' });

	if (!runId) {
		console.error(usage);
		return exitCli({ code: 1 });
	}

	// A run id the user typed is theirs to get wrong: an unknown one is a
	// message, never the stack of the manifest path we tried to open.
	const manifest = await readRunManifest({ cwd, runId }).catch((error: unknown) => {
		if (error instanceof RunNotFoundError) {
			console.error(error.message);
			return exitCli({ code: 1 });
		}

		throw error;
	});

	const pipeline = manifest.pipeline ?? 'implement';
	const ownCommand = resumeCommandByPipeline[pipeline];

	if (ownCommand) {
		console.error(`run ${manifest.runId} belongs to the ${pipeline} pipeline — resume it with: lightsout ${ownCommand} --run ${manifest.runId}`);
		return exitCli({ code: 1 });
	}

	if (manifest.status === RunStatus.Passed) {
		console.error(`run ${manifest.runId} already passed — nothing to resume`);
		return exitCli({ code: 1 });
	}

	const loaded = await readConfig({ cwd });
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

	const result =
		pipeline === 'phases'
			? await runPhasesOrFailFast({ cwd, driver, config, existing: manifest, skipRefactor, onProgress: createProgressPrinter() })
			: await runPipelineOrFailFast({
					cwd,
					driver,
					config,
					existing: manifest,
					skipRefactor,
					onProgress: createProgressPrinter(),
				});

	await printResult({ result, cwd });
	return exitForRunResult({ ok: result.ok, manifest: result.manifest });
};
