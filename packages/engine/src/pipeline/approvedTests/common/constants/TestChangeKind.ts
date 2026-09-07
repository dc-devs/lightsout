export const TestChangeKind = {
	/** No approved version, and the file is on disk. */
	Added: 'added',
	/** An approved version exists and the file on disk differs from it. */
	Modified: 'modified',
	/** An approved version exists and the file is gone from disk. */
	Removed: 'removed',
} as const;

export type TestChangeKind = (typeof TestChangeKind)[keyof typeof TestChangeKind];
