import type { LoadedStandardsDocument } from '#src/standardsPacks/common/types/LoadedStandardsDocument.ts';
import type { LoadedStandardsRule } from '#src/standardsPacks/common/types/LoadedStandardsRule.ts';

/** A whole standards pack as the loader read it off disk. */
export interface LoadedStandardsPack {
	name: string;
	formatVersion: number;
	/**
	 * Present and true for a pack the bundler produced, which ships without the
	 * fixture pairs and unit tests that prove it; absent for an authored one,
	 * exactly as the root file carries it. Nothing about running a pack depends
	 * on this — only `lightsout standards-validate`, which has nothing to run
	 * against a built pack and says so rather than blaming its rules.
	 */
	built?: true;
	/** Absolute pack root. */
	rootPath: string;
	documents: LoadedStandardsDocument[];
	rules: LoadedStandardsRule[];
}
