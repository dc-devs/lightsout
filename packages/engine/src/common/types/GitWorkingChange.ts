import type { GitChangeKind } from '#src/common/constants/GitChangeKind.ts';

/** One path git reports as changed in the working tree, with what happened to it. */
export interface GitWorkingChange {
	/** Relative to the `cwd` the reader was given, with a nested consumer's prefix stripped. */
	path: string;
	kind: GitChangeKind;
}
