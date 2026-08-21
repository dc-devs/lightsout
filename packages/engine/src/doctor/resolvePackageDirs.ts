import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { extractRunScriptName } from '#src/common/config/extractRunScriptName.ts';
import { readPackageManifest } from '#src/common/workspace/readPackageManifest.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { DoctorCheck } from '#src/doctor/common/types/DoctorCheck.ts';
import type { PackageDir } from '#src/doctor/common/types/PackageDir.ts';

interface Params {
	cwd: string;
	config: LightsoutConfig;
	packagesDir: string;
}

/**
 * Resolve the package dirs every later check iterates (root plus each scoped
 * package with a resolvable manifest) and, in monorepo mode, the scoped-gates
 * check: a package with no matching script is legitimate (infra, docs) — the
 * doctor names it so intent and accident are distinguishable.
 */
export const resolvePackageDirs = async ({ cwd, config, packagesDir }: Params): Promise<{ packageDirs: PackageDir[]; scopedGatesCheck?: DoctorCheck }> => {
	const packageDirs: PackageDir[] = [{ label: 'root', dir: cwd }];

	if (!config['package-gates']) {
		return { packageDirs };
	}

	const entries = await readdir(join(cwd, packagesDir), { withFileTypes: true }).catch(() => []);
	const templates = Object.entries(config['package-gates']).filter((pair): pair is [string, string] => typeof pair[1] === 'string');
	const skips: string[] = [];

	for (const entry of entries.filter((item) => item.isDirectory() && !item.name.startsWith('.'))) {
		const manifest = await readPackageManifest({ cwd, packagesDir, packageDir: entry.name }).catch(() => undefined);

		if (!manifest) {
			continue;
		}

		packageDirs.push({ label: entry.name, dir: join(cwd, packagesDir, entry.name) });

		const absent = templates
			.map(([kind, template]) => ({ kind, script: extractRunScriptName({ command: template }) }))
			.filter(({ script }) => script !== undefined && !Object.hasOwn(manifest.scripts, script));

		if (absent.length > 0) {
			skips.push(`${entry.name} (${absent.map(({ script }) => script).join(', ')})`);
		}
	}

	const scopedGatesCheck: DoctorCheck =
		skips.length === 0
			? { id: 'scoped-gates', status: 'pass', detail: 'every package defines every scoped gate script' }
			: {
					id: 'scoped-gates',
					status: 'note',
					detail: `gates will skip for: ${skips.join('; ')} — intentional if these packages have nothing to check; a typo'd script name looks identical`,
				};

	return { packageDirs, scopedGatesCheck };
};
