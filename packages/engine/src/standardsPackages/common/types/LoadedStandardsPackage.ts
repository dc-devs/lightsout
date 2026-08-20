import type { LoadedStandardsDocument } from '#src/standardsPackages/common/types/LoadedStandardsDocument.ts';
import type { LoadedStandardsRule } from '#src/standardsPackages/common/types/LoadedStandardsRule.ts';

/** A whole standards package as the loader read it off disk. */
export interface LoadedStandardsPackage {
	name: string;
	formatVersion: number;
	/**
	 * Present and true for a package the bundler produced, which ships without
	 * the fixture pairs and unit tests that prove it; absent for an authored one,
	 * exactly as the root file carries it. Nothing about running a package
	 * depends on this — only `lightsout standards-validate`, which has nothing to
	 * run against a built package and says so rather than blaming its rules.
	 */
	built?: true;
	/** Absolute package root. */
	rootPath: string;
	documents: LoadedStandardsDocument[];
	rules: LoadedStandardsRule[];
}
