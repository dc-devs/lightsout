interface Params {
	/** A repo-relative path. */
	path: string;
}

/**
 * Whether a path is a test file or test-support file — by its name, or by a
 * test directory anywhere above it.
 *
 * The rules that count references need this to tell a test's mention of a name
 * from production code's, and it has to agree with how the engine split the
 * same file list into `source` and `tests` in the first place.
 */
export const isTestFile = ({ path }: Params): boolean => /(^|\/)(tests?|__tests__|__mocks__|e2e)\//.test(path) || /\.(test|spec)\./.test(path);
