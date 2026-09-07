import type { TestChangeKind } from '#src/pipeline/approvedTests/common/constants/TestChangeKind.ts';

/** One entry of a checkpoint's change bundle: a test-side file whose live content differs from its approved version. */
export interface TestChange {
	/** Repo-relative path. */
	path: string;
	kind: TestChangeKind;
	/** Unified diff, approved version to live file. */
	diff: string;
}
