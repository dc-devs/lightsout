import type { StandardsCheckInput, TestFileInput } from '@lightsout/standards-contracts';
import { StandardsInputKind } from '@lightsout/standards-contracts';

interface Params extends Partial<Omit<TestFileInput, 'kind' | 'contents'>> {
	/** Each test file and what it says, as pairs. */
	contents?: Array<[string, string]>;
}

/**
 * The input a `test-file` check receives, built in memory.
 *
 * `tests` defaults to the paths given, since a rule about test files is handed
 * only test files in the first place.
 *
 * @param contents - each test file and its text
 */
export const setupTestFileInput = ({ contents = [], ...overrides }: Params = {}): StandardsCheckInput => ({
	kind: StandardsInputKind.TestFile,
	cwd: '/repo',
	tests: contents.map(([path]) => path),
	contents: new Map(contents),
	...overrides,
});
