import { dim } from '@/cli/common/terminal/dim';
import { listSourceFiles } from '@/common/utils/listSourceFiles';
import type { LightsoutConfig, StandardsFinding } from '@/contracts';
import { getDriver } from '@/drivers';
import { detectStandardsChannels } from '@/standards';
import { runStandardsReview } from '@/standardsCheck';
import { resolveStandardsPackages } from '@/standardsPackages';

interface Params {
	cwd: string;
	config?: LightsoutConfig;
	/** Repo-relative subtree to review — absent means the whole repo. */
	path?: string;
}

/**
 * The agent's read of the judgment-only rules, over the same scope the machine
 * half checked. Everything the review needs is resolved here rather than by
 * the runner — packages, channels, file scope, harness, time bound — so a run
 * that never asks for the review never loads a package or a harness for it.
 */
export const reviewStandards = async ({ cwd, config, path }: Params): Promise<{ findings: StandardsFinding[]; notes: string[] }> => {
	const defaultAgentTimeoutMinutes = 60;
	const packages = await resolveStandardsPackages({ cwd, config });
	// No package scope on a standalone command, so the root package.json decides
	// the channels — the same call the machine half makes.
	const channels = config?.standardsChannels ?? (await detectStandardsChannels({ cwd, packagesDir: config?.packagesDir ?? 'packages', packages: [] }));
	const { files: walked } = await listSourceFiles({ cwd, exclude: config?.generated });
	const files = walked.filter((file) => !path || file.startsWith(path));

	return runStandardsReview({
		cwd,
		driver: getDriver({ name: config?.harness ?? 'claude-code' }),
		packages,
		channels,
		files,
		timeoutMs: (config?.timeouts?.agentMinutes ?? defaultAgentTimeoutMinutes) * 60_000,
		onProgress: (message) => console.log(dim(message)),
	});
};
