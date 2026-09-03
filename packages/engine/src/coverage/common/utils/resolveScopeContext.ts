import { resolve } from 'node:path';
import { defaultCoverageSummaryPath } from '#src/common/constants/defaultCoverageSummaryPath.ts';
import { defaultPackagesDir } from '#src/common/constants/defaultPackagesDir.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { CoverageScope } from '#src/coverage/common/types/CoverageScope.ts';
import { resolveCoverageScopes } from '#src/coverage/resolveCoverageScopes.ts';

interface Params {
	cwd: string;
	config: LightsoutConfig;
}

/**
 * Everything a per-file selector needs to decide which coverage scope measures
 * a repo-relative path: the arguments `coverageScopeOf` takes, plus the
 * absolute root the file paths are relative to.
 *
 * Shared because both selectors read the same three settings off the same
 * configuration before walking their files, and a copy drifting would have them
 * disagree about which scope owns a file — the disagreement each selector
 * exists to rule out.
 */
export const resolveScopeContext = async ({
	cwd,
	config,
}: Params): Promise<{ root: string; packagesDir: string; monorepo: boolean; scopes: CoverageScope[] }> => {
	const summaryPath = config['coverage-summary-path'] ?? defaultCoverageSummaryPath;

	return {
		root: resolve(cwd),
		packagesDir: config['packages-dir'] ?? defaultPackagesDir,
		monorepo: config['package-gates']?.['test-coverage'] !== undefined,
		scopes: await resolveCoverageScopes({ cwd, config, summaryPath }),
	};
};
