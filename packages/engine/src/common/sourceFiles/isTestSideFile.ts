import { isSnapshotFile } from '#src/common/sourceFiles/isSnapshotFile.ts';
import { isTestFile } from '#src/common/sourceFiles/isTestFile.ts';

/**
 * A jest config file — what decides which tests are collected at all. The same
 * expression `findJestConfigs` applies, so the doctor and the reviewer agree
 * about which files those are.
 */
const jestConfigFileName = /^jest(\..+)?\.config\.(js|cjs|mjs|ts)$/;

interface Params {
	/** A repo-relative path. */
	path: string;
	/** Repo-relative roots of the standards packs in the tree, passed straight through to `isTestFile`. */
	standardsPacks?: string[];
}

/**
 * Whether a path is test-side — the widened question the test-change review
 * asks: not only "is this a test?" but "could changing this change what the
 * tests prove?".
 *
 * It is `isTestFile` plus the two file kinds that decide a test's verdict
 * without stating an assertion in code. A snapshot IS the expected value, so a
 * rewritten one can hide the behaviour change it was written to catch. A jest
 * config decides which files are collected, so an edit there can stop a test
 * from running at all without touching a line of it.
 */
export const isTestSideFile = ({ path, standardsPacks }: Params): boolean => {
	const name = path.slice(path.lastIndexOf('/') + 1);

	return isTestFile({ path, standardsPacks }) || isSnapshotFile({ path }) || jestConfigFileName.test(name);
};
