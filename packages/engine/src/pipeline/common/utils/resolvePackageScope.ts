import { type LightsoutConfig, PackagesSource } from '#src/contracts/index.ts';
import { readPlanPackages } from '#src/pipeline/readPlanPackages.ts';
import { scanPlanPackagePaths } from '#src/pipeline/scanPlanPackagePaths.ts';

interface Params {
	config: LightsoutConfig;
	/** Scope already on the manifest — non-empty means a resume settled this. */
	current: string[];
	/** The `--packages` flag, when the caller passed one. */
	packages?: string[];
	planContent: string;
	packagesDir: string;
}

/**
 * Which packages a monorepo run is scoped to, and where that answer came from.
 *
 * The chain is `--packages` flag → plan front-matter `packages:` list →
 * concrete package paths referenced in the plan body → hard error. Falling back
 * to plan paths is safe in one direction only: over-inclusion just runs extra
 * gates, while under-inclusion is caught later by scope expansion as changed
 * files reveal the real blast radius. Nothing beyond that is inferred — a run
 * that cannot name its scope must stop, because every gate afterwards would be
 * scoped to a guess.
 *
 * Returns no scope at all when there is nothing to settle: a single-repo config
 * has no package scope, and a resume already has one.
 */
export const resolvePackageScope = ({
	config,
	current,
	packages,
	planContent,
	packagesDir,
}: Params): { scope?: { packages: string[]; packagesSource: PackagesSource } } | { error: string } => {
	if (!config['package-gates'] || current.length > 0) {
		return {};
	}

	const fromFlag = packages;
	const fromFrontMatter = fromFlag ? undefined : readPlanPackages({ planContent });
	const fromPlanPaths = (fromFlag ?? fromFrontMatter) ? undefined : scanPlanPackagePaths({ planContent, packagesDir });
	const declared = fromFlag ?? fromFrontMatter ?? fromPlanPaths;

	if (!declared || declared.length === 0) {
		return {
			error: `package-gates is configured but no package scope could be resolved — add a \`packages:\` list to the plan front-matter, pass --packages <a,b>, or reference concrete ${packagesDir}/<name>/ paths in the plan.`,
		};
	}

	return {
		scope: {
			packages: declared,
			packagesSource: fromFlag ? PackagesSource.Flag : fromFrontMatter ? PackagesSource.FrontMatter : PackagesSource.PlanPaths,
		},
	};
};
