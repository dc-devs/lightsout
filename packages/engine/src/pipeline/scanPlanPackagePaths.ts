interface Params {
	planContent: string;
	packagesDir: string;
}

/**
 * Derive a package scope from concrete `<packagesDir>/<name>/` path
 * references in a plan's body — the fallback for plans no tool taught to
 * declare scope (raw plan-mode output, hand-written plans). A deterministic
 * regex that deliberately does not judge whether a name is a real package —
 * `resolvePackageScope` reconciles the result against the packages that exist,
 * filtering out the names that match nothing. What survives can still be
 * over-inclusive (a real package mentioned only as context), which just runs
 * extra gates, and under-inclusion is caught by scope expansion once changed
 * files reveal it. Returns undefined when the plan references no package paths
 * at all.
 */
export const scanPlanPackagePaths = ({ planContent, packagesDir }: Params): string[] | undefined => {
	const escaped = packagesDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const pattern = new RegExp(`(?:^|[^\\w@./-])${escaped}/([\\w.@-]+)/`, 'g');
	const found = [...planContent.matchAll(pattern)].map((match) => match[1]).filter((name): name is string => Boolean(name));

	return found.length > 0 ? [...new Set(found)] : undefined;
};
