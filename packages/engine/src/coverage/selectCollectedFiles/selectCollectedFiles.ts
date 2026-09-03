import { join } from 'node:path';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { coverageScopeOf } from '#src/coverage/common/utils/coverageScopeOf.ts';
import { resolveScopeContext } from '#src/coverage/common/utils/resolveScopeContext.ts';
import { scopeRootOf } from '#src/coverage/common/utils/scopeRootOf.ts';
import { loadScopeJestConfig } from '#src/coverage/loadScopeJestConfig/index.ts';
import type { CoverageCollection } from '#src/coverage/selectCollectedFiles/common/types/CoverageCollection.ts';
import { isCoverageCollectedFile } from '#src/coverage/selectCollectedFiles/common/utils/isCoverageCollectedFile.ts';
import { readCoverageCollection } from '#src/coverage/selectCollectedFiles/common/utils/readCoverageCollection.ts';

interface Params {
	cwd: string;
	config: LightsoutConfig;
	/** Repo-relative candidate files to split. */
	files: string[];
}

/**
 * Split candidate files by whether the repo's own coverage configuration
 * collects them.
 *
 * One function answers this for every caller on purpose. The gate and the
 * write-tests target selection ask the same question, and two copies of it are
 * exactly how a writer gets asked for a test the gate would then exempt.
 *
 * A file no scope measures counts as collected: that is the caller's own
 * question to answer, and the gate already skips it for a different reason.
 */
export const selectCollectedFiles = async ({ cwd, config, files }: Params): Promise<{ collected: string[]; excluded: string[] }> => {
	const { root, packagesDir, monorepo, scopes } = await resolveScopeContext({ cwd, config });
	const collections = new Map<string, CoverageCollection | undefined>();
	const collected: string[] = [];
	const excluded: string[] = [];

	for (const file of files) {
		const scope = coverageScopeOf({ file, scopes, packagesDir, monorepo });

		if (scope === undefined) {
			collected.push(file);
			continue;
		}

		if (!collections.has(scope.scope)) {
			const scopeRoot = scopeRootOf({ root, scope: scope.scope, packagesDir, monorepo });

			collections.set(scope.scope, readCoverageCollection({ loaded: await loadScopeJestConfig({ scopeRoot, command: scope.command }) }));
		}

		const collection = collections.get(scope.scope);

		(isCoverageCollectedFile({ absolutePath: join(root, file), collection }) ? collected : excluded).push(file);
	}

	return { collected, excluded };
};
