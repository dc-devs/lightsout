import { listSourceFiles } from '#src/common/sourceFiles/listSourceFiles.ts';
import type { LightsoutConfig, StandardsFinding } from '#src/contracts/index.ts';
import { getDriver } from '#src/drivers/index.ts';
import { detectStandardsChannels } from '#src/standards/index.ts';
import { runStandardsReview } from '#src/standardsCheck/index.ts';
import { resolveStandardsPackages } from '#src/standardsPackages/index.ts';

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
 * the runner — packages, channels, file scope, harness, time bound — so a run
 * that never asks for the review never loads a package or a harness for it.
 */
export const reviewStandards = async ({ cwd, config, path, onProgress }: Params): Promise<{ findings: StandardsFinding[]; notes: string[] }> => {
	const defaultAgentTimeoutMinutes = 60;
	const packages = await resolveStandardsPackages({ cwd, config });
	// No package scope on a standalone command, so the root package.json decides
	// the channels — the same call the machine half makes.
	const channels =
		config?.['standards-channels'] ?? (await detectStandardsChannels({ cwd, packagesDir: config?.['packages-dir'] ?? 'packages', packages: [] }));
	const { files: walked } = await listSourceFiles({ cwd, exclude: config?.generated });
	const files = walked.filter((file) => !path || file.startsWith(path));

	return runStandardsReview({
		cwd,
		driver: getDriver({ name: config?.harness ?? 'claude-code' }),
		packages,
		channels,
		files,
		timeoutMs: (config?.timeouts?.['agent-minutes'] ?? defaultAgentTimeoutMinutes) * 60_000,
		onProgress,
	});
};
