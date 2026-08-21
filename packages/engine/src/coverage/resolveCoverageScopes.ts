import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { extractRunScriptName } from '#src/common/config/extractRunScriptName.ts';
import { defaultPackagesDir } from '#src/common/constants/defaultPackagesDir.ts';
import { readPackageManifest } from '#src/common/workspace/readPackageManifest.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { CoverageScope } from '#src/coverage/common/types/CoverageScope.ts';

const rootScope = 'root';

/**
 * Every package under packagesDir that defines the coverage template's run
 * script, narrowed to one package when the caller named a scope. The
 * script-missing skip mirrors `runPackageGates`: a scoped template fans out to
 * packages the consumer never hand-tuned, and one with nothing to measure is
 * legitimate.
 */
const listPackageScopes = async ({
	cwd,
	packagesDir,
	template,
	summaryPath,
	scope,
}: {
	cwd: string;
	packagesDir: string;
	template: string;
	summaryPath: string;
	scope?: string;
}) => {
	const entries = await readdir(join(cwd, packagesDir), { withFileTypes: true }).catch(() => []);
	const scriptName = extractRunScriptName({ command: template });
	const scopes: CoverageScope[] = [];

	for (const entry of entries.filter((item) => item.isDirectory() && !item.name.startsWith('.'))) {
		if (scope !== undefined && scope !== entry.name) {
			continue;
		}

		const manifest = await readPackageManifest({ cwd, packagesDir, packageDir: entry.name }).catch(() => undefined);

		if (!manifest || (scriptName !== undefined && !Object.hasOwn(manifest.scripts, scriptName))) {
			continue;
		}

		scopes.push({
			scope: entry.name,
			command: template.split('{package}').join(manifest.name),
			summaryPath: join(packagesDir, entry.name, summaryPath),
		});
	}

	return scopes;
};

interface Params {
	cwd: string;
	config: LightsoutConfig;
	/** Repo- or package-relative summary path (config['coverage-summary-path'] ?? defaultCoverageSummaryPath). */
	summaryPath: string;
	/** Restrict to one package dir. Undefined = every configured scope. */
	scope?: string;
}

/**
 * Which commands make up a coverage measurement, and where each writes its
 * summary. Monorepo mode — a scoped coverage template — measures packages
 * ONLY: `gates.*` is the root-group gate, and a whole-repo root measure would
 * count every package file a second time under a scope no batch belongs to.
 */
export const resolveCoverageScopes = async ({ cwd, config, summaryPath, scope }: Params): Promise<CoverageScope[]> => {
	const template = config['package-gates']?.['test-coverage'];

	if (template) {
		return listPackageScopes({ cwd, packagesDir: config['packages-dir'] ?? defaultPackagesDir, template, summaryPath, scope });
	}

	const command = config.gates['test-coverage'];
	const scoped: CoverageScope[] =
		typeof command === 'string' && (scope === undefined || scope === rootScope) ? [{ scope: rootScope, command, summaryPath }] : [];

	return scoped;
};
