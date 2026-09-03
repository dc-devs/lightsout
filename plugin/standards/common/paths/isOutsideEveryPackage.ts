interface Params {
	/** A repo-relative path. */
	path: string;
	/** Repo-relative package roots, exactly as the input's `dependencies` map keys carry them — `.` for the repo itself, then one entry per workspace package that ships a manifest. */
	packageDirectories: string[];
}

/**
 * Whether a file belongs to no workspace package at all — a build script at the
 * repo root, say, sitting outside every package the manifests declare.
 *
 * Module boundaries are a package's own architecture. A file outside every
 * package is inside nobody's architecture, so a rule about one package's
 * internal boundaries has nothing to hold it to, and no edit to that file could
 * satisfy one.
 *
 * A repo whose manifests declare no workspace package answers `false` for every
 * path: such a repo IS one package, and reading it the other way would switch
 * the caller's rule off in every single-package repo — the failure this
 * distinction exists to prevent, inverted.
 *
 * `.` is the repo itself and prefixes nothing, so it is dropped before the
 * comparison rather than matched. The trailing `/` is what keeps a root from
 * claiming a sibling whose name merely starts with it — `packages/engine` is
 * not `packages/engine-tools`.
 *
 * One known limit: the keys come from the engine's single configured packages
 * directory, so a repo spreading its members over two parents has only the
 * configured one discovered and reads the other as outside every package. That
 * is the engine's existing repo model (`docs/monorepos.md`), not this helper's.
 */
export const isOutsideEveryPackage = ({ path, packageDirectories }: Params): boolean => {
	const workspacePackages = packageDirectories.filter((directory) => directory !== '.');

	return workspacePackages.length > 0 && !workspacePackages.some((directory) => path.startsWith(`${directory}/`));
};
