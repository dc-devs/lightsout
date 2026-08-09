/** A directory whose name says everything under it is test code. */
const testDirectory = /(^|\/)(tests?|__tests__|__mocks__|e2e)\//;

/**
 * The same, minus `test`/`tests`. Inside a standards package those name a
 * document set — the standards about how to write tests — and the rule
 * implementations under one are ordinary source.
 */
const testDirectoryInStandardsPackage = /(^|\/)(__tests__|__mocks__|e2e)\//;

/** A filename that says it is a test, wherever it sits. */
const testFileName = /\.(test|spec)\./;

interface Params {
	/** A repo-relative path. */
	path: string;
	/** Repo-relative standards package roots, as the input carries them. Only a path beneath one is judged by a package's naming. */
	standardsPackages?: string[];
}

/**
 * Whether a path is a test file or test-support file — by its name, or by a
 * test directory anywhere above it.
 *
 * The rules that count references need this to tell a test's mention of a name
 * from production code's, and it has to agree with how the engine split the
 * same file list into `source` and `tests` in the first place.
 *
 * A standards package is called out for the same reason the engine calls it
 * out. A package sorts its rules into two sets, `code` and `tests`, and the
 * second is a set name rather than a directory of tests: every `check.ts`
 * beneath it is ordinary source. Its own tests still say so in their names.
 */
export const isTestFile = ({ path, standardsPackages = [] }: Params): boolean => {
	const inStandardsPackage = standardsPackages.some((root) => path.startsWith(`${root}/`));
	const directory = inStandardsPackage ? testDirectoryInStandardsPackage : testDirectory;

	return directory.test(path) || testFileName.test(path);
};
