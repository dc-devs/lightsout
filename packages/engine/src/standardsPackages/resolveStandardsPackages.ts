import { isAbsolute, resolve } from 'node:path';
import type { LightsoutConfig } from '@/contracts';
import type { LoadedStandardsPackage } from '@/standardsPackages/common/types/LoadedStandardsPackage';
import { loadStandardsPackage } from '@/standardsPackages/loadStandardsPackage';
import { resolveDefaultStandardsPackage } from '@/standardsPackages/resolveDefaultStandardsPackage';

interface Params {
	cwd: string;
	config?: LightsoutConfig;
}

/** The roots the config asks for, absolute — its three-way meaning stated once. */
const resolveRoots = ({ cwd, standardsPackages }: { cwd: string; standardsPackages: string[] | false | undefined }) => {
	if (standardsPackages === false) {
		return [];
	}

	if (standardsPackages === undefined) {
		return [resolveDefaultStandardsPackage()];
	}

	return standardsPackages.map((entry) => (isAbsolute(entry) ? entry : resolve(cwd, entry)));
};

/**
 * Rule ids collide across packages exactly as they collide inside one: a config
 * override or a site key naming the id would be ambiguous. Each package
 * validated itself at load, so anything left here is a cross-package clash.
 */
const findCrossPackageDuplicates = ({ packages }: { packages: LoadedStandardsPackage[] }) => {
	const owners = new Map<string, LoadedStandardsPackage>();
	const duplicates: string[] = [];

	for (const pkg of packages) {
		for (const rule of pkg.rules) {
			const owner = owners.get(rule.id);

			if (owner === undefined) {
				owners.set(rule.id, pkg);
			} else {
				duplicates.push(`duplicate rule id "${rule.id}": claimed by ${owner.name} (${owner.rootPath}) and ${pkg.name} (${pkg.rootPath})`);
			}
		}
	}

	return duplicates;
};

/**
 * Load every standards package a run works against — the one place the config's
 * three-way meaning is encoded: unspecified = the package the plugin ships
 * (announced, never silent), `false` = explicitly none, an array = exactly
 * these roots, each resolved against the consumer repo unless already absolute.
 *
 * Packages load in the order listed, one at a time, so the first bad root is
 * the one reported. Loading is left to throw — a consumer that declared
 * standards and did not get them must not run.
 *
 * @param cwd - the consumer repo, which relative package roots resolve against
 * @param config - the consumer's config; absent means the bundled default package
 * @throws {Error} When a declared package cannot be loaded, or two loaded packages claim one rule id.
 */
export const resolveStandardsPackages = async ({ cwd, config }: Params): Promise<LoadedStandardsPackage[]> => {
	const roots = resolveRoots({ cwd, standardsPackages: config?.['standards-packages'] });
	const packages: LoadedStandardsPackage[] = [];

	for (const packagePath of roots) {
		packages.push(await loadStandardsPackage({ packagePath }));
	}

	const duplicates = findCrossPackageDuplicates({ packages });

	if (duplicates.length > 0) {
		throw new Error(`standards packages disagree about rule ids:\n${duplicates.map((duplicate) => `- ${duplicate}`).join('\n')}`);
	}

	return packages;
};
