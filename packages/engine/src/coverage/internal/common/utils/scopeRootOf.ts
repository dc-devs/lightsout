import { join } from 'node:path';

interface Params {
	/** Absolute repo root. */
	root: string;
	/** The scope's name, as `CoverageScope.scope` carries it. */
	scope: string;
	/** The workspace's packages folder. */
	packagesDir: string;
	/** True when a scoped coverage template is configured — each package is its own scope with its own root; false when a single root command owns everything. */
	monorepo: boolean;
}

/**
 * The directory a coverage scope's own configuration is read from: a package
 * directory in monorepo mode, the repo root otherwise.
 *
 * Shared because two readers now resolve a scope's configuration, and a copy
 * drifting would have them read different files for the same scope.
 */
export const scopeRootOf = ({ root, scope, packagesDir, monorepo }: Params): string => (monorepo ? join(root, packagesDir, scope) : root);
