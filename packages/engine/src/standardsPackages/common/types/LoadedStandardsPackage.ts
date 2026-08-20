import type { LoadedStandardsDocument } from '#src/standardsPackages/common/types/LoadedStandardsDocument.ts';
import type { LoadedStandardsRule } from '#src/standardsPackages/common/types/LoadedStandardsRule.ts';

/** A whole standards package as the loader read it off disk. */
export interface LoadedStandardsPackage {
	name: string;
	formatVersion: number;
	/** Absolute package root. */
	rootPath: string;
	documents: LoadedStandardsDocument[];
	rules: LoadedStandardsRule[];
}
