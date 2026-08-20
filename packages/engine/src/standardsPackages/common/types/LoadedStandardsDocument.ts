import type { StandardsSet } from '#src/contracts/index.ts';

/** One document folder, read: its intro prose and the rules it owns, in assembly order. */
export interface LoadedStandardsDocument {
	set: StandardsSet;
	/** Package-relative folder path — the assembly header names it. */
	path: string;
	/** 'base' when document.md front matter declares no channel. */
	channel: string;
	/** document.md body — title and intro prose. */
	intro: string;
	/** Rule ids in assembly (folder) order. */
	ruleIds: string[];
}
