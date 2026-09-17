import { defaultPackagesDir } from '#src/common/constants/defaultPackagesDir.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { detectStandardsChannels } from '#src/standards/detectStandardsChannels.ts';

interface Params {
	cwd: string;
	/** The consumer's config, absent on a repo that has none. */
	config: LightsoutConfig | undefined;
	/** Package scope whose dependencies decide the channels. Empty = the root package.json decides. */
	packages: string[];
}

/**
 * Which framework standards channels a run reads: what the config says, or what
 * the packages in scope turn out to depend on.
 *
 * The precedence and the packages-dir fallback are stated once because five
 * callers across the prompt side, the check side, the planning command and the
 * refactor loop all need the same answer. Written out per caller they are five
 * copies of a rule that has to agree, and a run whose prose and whose checks
 * disagreed about which frameworks a repo is in would be wrong in a way nothing
 * reports.
 *
 * @param cwd - the consumer repo
 * @param config - the consumer's config, whose `standards-channels` key overrides detection outright
 * @param packages - the run's package scope, which detection reads
 */
export const resolveStandardsChannels = async ({ cwd, config, packages }: Params): Promise<string[]> =>
	config?.['standards-channels'] ?? detectStandardsChannels({ cwd, packagesDir: config?.['packages-dir'] ?? defaultPackagesDir, packages });
