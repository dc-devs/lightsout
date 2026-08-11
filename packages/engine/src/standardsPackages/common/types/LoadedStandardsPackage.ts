import type { LoadedStandardsDocument } from '@/standardsPackages/common/types/LoadedStandardsDocument';
import type { LoadedStandardsRule } from '@/standardsPackages/common/types/LoadedStandardsRule';

/** A whole standards package as the loader read it off disk. */
export interface LoadedStandardsPackage {
	name: string;
	formatVersion: number;
	/** Absolute package root. */
	rootPath: string;
	documents: LoadedStandardsDocument[];
	rules: LoadedStandardsRule[];
}
