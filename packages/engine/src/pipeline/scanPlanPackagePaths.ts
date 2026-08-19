interface Params {
	planContent: string;
	packagesDir: string;
}

/**
 * Derive a package scope from concrete `<packagesDir>/<name>/` path
 * references in a plan's body — the fallback for plans no tool taught to
 * declare scope (raw plan-mode output, hand-written plans). Deterministic
 * regex, and safe in both failure directions: over-inclusion (a package
 * mentioned only as context) just runs extra gates; under-inclusion is
 * caught by scope expansion once changed files reveal it. Returns undefined
 * when the plan references no package paths at all.
 */
export const scanPlanPackagePaths = ({ planContent, packagesDir }: Params): string[] | undefined => {
	const escaped = packagesDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const pattern = new RegExp(`(?:^|[^\\w@./-])${escaped}/([\\w.@-]+)/`, 'g');
	const found = [...planContent.matchAll(pattern)].map((match) => match[1]).filter((name): name is string => Boolean(name));

	return found.length > 0 ? [...new Set(found)] : undefined;
};
