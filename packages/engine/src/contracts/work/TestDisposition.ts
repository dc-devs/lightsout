export const TestDisposition = {
	/** The acceptance test is still in this file under this name. */
	Kept: 'kept',
	/** Still in this file, under a new name. Requires `newTestName`. */
	Renamed: 'renamed',
	/** Same name, now in a different file. Requires `testFile`. */
	Moved: 'moved',
	/** Superseded by a different test the plan authorises. Requires both `testFile` and `newTestName`. */
	Replaced: 'replaced',
} as const;

export type TestDisposition = (typeof TestDisposition)[keyof typeof TestDisposition];
