import { packageOf } from '#src/common/workspace/packageOf.ts';
import type { CoverageScope } from '#src/coverage/common/types/CoverageScope.ts';

interface Params {
	/** Repo-relative file path. */
	file: string;
	/** The scopes `resolveCoverageScopes` produced for this run. */
	scopes: CoverageScope[];
	/** The workspace's packages folder. */
	packagesDir: string;
	/** True when a scoped coverage template is configured — packages are measured and root files are not; false when a single root command owns everything outside the packages dir. */
	monorepo: boolean;
}

/**
 * The coverage scope that measures a file, or undefined when no command
 * measures it.
 *
 * Monorepo mode measures packages only, so root files sit outside the
 * measurement; root mode's single scope owns files outside the packages dir.
 */
export const coverageScopeOf = ({ file, scopes, packagesDir, monorepo }: Params): CoverageScope | undefined => {
	const packageDir = packageOf({ file, packagesDir });

	if (monorepo) {
		return packageDir === undefined ? undefined : scopes.find((entry) => entry.scope === packageDir);
	}

	return packageDir === undefined ? scopes[0] : undefined;
};
