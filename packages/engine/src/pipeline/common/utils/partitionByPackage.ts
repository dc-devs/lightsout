import { packageOf } from '#src/common/utils/packageOf.ts';

interface Params {
	/** Repo-relative files to bucket. */
	files: string[];
	/** Monorepo package parent dir (config['packages-dir'] ?? defaultPackagesDir). */
	packagesDir: string;
}

/**
 * Files grouped by owning package, with root files under the `''` key — the
 * partition every per-package pass shares, so a subject walk and the grouping
 * that consumes it can never disagree about which files sit together.
 */
export const partitionByPackage = ({ files, packagesDir }: Params): Map<string, string[]> => {
	const byPackage = new Map<string, string[]>();

	for (const file of files) {
		const key = packageOf({ file, packagesDir }) ?? '';

		byPackage.set(key, [...(byPackage.get(key) ?? []), file]);
	}

	return byPackage;
};
