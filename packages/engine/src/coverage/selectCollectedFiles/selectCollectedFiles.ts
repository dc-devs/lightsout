import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { extractRunScriptName } from '#src/common/config/extractRunScriptName.ts';
import { defaultCoverageSummaryPath } from '#src/common/constants/defaultCoverageSummaryPath.ts';
import { defaultPackagesDir } from '#src/common/constants/defaultPackagesDir.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { coverageScopeOf } from '#src/coverage/common/utils/coverageScopeOf.ts';
import { resolveCoverageScopes } from '#src/coverage/resolveCoverageScopes.ts';
import type { CoverageCollection } from '#src/coverage/selectCollectedFiles/common/types/CoverageCollection.ts';
import { isCoverageCollectedFile } from '#src/coverage/selectCollectedFiles/common/utils/isCoverageCollectedFile.ts';
import { readCoverageCollection } from '#src/coverage/selectCollectedFiles/common/utils/readCoverageCollection.ts';

const ScopeManifest = z.looseObject({ scripts: z.record(z.string(), z.string()).optional().catch(undefined) });

// The command a scope's coverage gate ultimately runs. A gate command is
// usually a workspace runner pointed at a script (`pnpm --filter x run
// test:unit:coverage`), and it is that script's body — not the runner
// invocation — that names the Jest config. `readPackageManifest` is not the
// reader for this: it throws on a manifest with no `name`, which is right when
// the engine needs a workspace filter and wrong here, where an unreadable
// manifest simply means "assume collected".
const resolveScopeCoverageScript = async ({ scopeRoot, command }: { scopeRoot: string; command: string }) => {
	const scriptName = extractRunScriptName({ command });

	if (scriptName === undefined) {
		return command;
	}

	try {
		const parsed = ScopeManifest.safeParse(JSON.parse(await readFile(join(scopeRoot, 'package.json'), 'utf8')));

		return parsed.success ? parsed.data.scripts?.[scriptName] : undefined;
	} catch {
		return undefined;
	}
};

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
	const packagesDir = config['packages-dir'] ?? defaultPackagesDir;
	const monorepo = config['package-gates']?.['test-coverage'] !== undefined;
	const summaryPath = config['coverage-summary-path'] ?? defaultCoverageSummaryPath;
	const scopes = await resolveCoverageScopes({ cwd, config, summaryPath });
	const root = resolve(cwd);
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
			const scopeRoot = monorepo ? join(root, packagesDir, scope.scope) : root;
			const coverageScript = await resolveScopeCoverageScript({ scopeRoot, command: scope.command });

			collections.set(scope.scope, await readCoverageCollection({ scopeRoot, coverageScript }));
		}

		const collection = collections.get(scope.scope);

		(isCoverageCollectedFile({ absolutePath: join(root, file), collection }) ? collected : excluded).push(file);
	}

	return { collected, excluded };
};
