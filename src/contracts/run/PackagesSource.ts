export const PackagesSource = {
	/** Explicit `--packages` flag. */
	Flag: 'flag',
	/** The plan's front-matter `packages:` list. */
	FrontMatter: 'front-matter',
	/** Derived from concrete `<packagesDir>/<name>/` paths in the plan body. */
	PlanPaths: 'plan-paths',
} as const;

export type PackagesSource = (typeof PackagesSource)[keyof typeof PackagesSource];
