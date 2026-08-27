import { defaultAgentTimeoutMinutes } from '#src/common/constants/defaultAgentTimeoutMinutes.ts';
import { excludedSourcePaths } from '#src/common/sourceFiles/excludedSourcePaths.ts';
import { listSourceFiles } from '#src/common/sourceFiles/listSourceFiles.ts';
import type { LightsoutConfig, StandardsFinding } from '#src/contracts/index.ts';
import { getDriver } from '#src/drivers/index.ts';
import { resolveStandardsChannels } from '#src/standards/index.ts';
import { runStandardsReview } from '#src/standardsCheck/index.ts';
import { resolveStandardsPacks } from '#src/standardsPacks/index.ts';

interface Params {
	cwd: string;
	config?: LightsoutConfig;
	/** Repo-relative subtree to review — absent means the whole repo. */
	path?: string;
	/** Relayed from the runner: the opening line, the heartbeat while the agent works, the closing line. */
	onProgress?: (message: string) => void;
}

/**
 * The agent's read of the judgment-only rules, over the same scope the machine
 * half checked. Everything the review needs is resolved here rather than by
 * the runner — packs, channels, file scope, harness, time bound — so a run
 * that never asks for the review never loads a pack or a harness for it.
 */
export const reviewStandards = async ({ cwd, config, path, onProgress }: Params): Promise<{ findings: StandardsFinding[]; notes: string[] }> => {
	const packs = await resolveStandardsPacks({ cwd, config });
	// No package scope on a standalone command, so the root package.json decides.
	const channels = await resolveStandardsChannels({ cwd, config, packages: [] });
	const { files: walked } = await listSourceFiles({ cwd, exclude: excludedSourcePaths({ config }) });
	const files = walked.filter((file) => !path || file.startsWith(path));

	return runStandardsReview({
		cwd,
		driver: getDriver({ name: config?.harness ?? 'claude-code' }),
		packs,
		channels,
		files,
		timeoutMs: (config?.timeouts?.['agent-minutes'] ?? defaultAgentTimeoutMinutes) * 60_000,
		onProgress,
	});
};
