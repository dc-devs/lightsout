import { StandardsInputKind, type TestFileInput } from '@/contracts';
import { readIntoCache } from '@/standardsCheck/common/checkInputs/readIntoCache';

interface Params {
	cwd: string;
	tests: string[];
	/** The run's shared cache — a test file the text input already read is not read again. */
	cache: Map<string, string>;
}

/**
 * The test files and their text. `contents` holds the test paths alone, not the
 * whole shared cache: a test-shape rule that could reach source files through
 * its input would be checking something its declaration does not claim.
 *
 * @param cache - the run's shared cache, read through and filled in place
 */
export const buildTestFileInput = async ({ cwd, tests, cache }: Params): Promise<TestFileInput> => {
	const contents = await readIntoCache({ cwd, paths: tests, cache });

	return { kind: StandardsInputKind.TestFile, cwd, tests, contents };
};
