import { describe, expect, test } from '@jest/globals';
import { TestResultsFile } from '#src/contracts/index.ts';

const setupResultsFile = ({
	assertion = {},
	entry = {},
	omitFromEntry,
}: {
	assertion?: Record<string, unknown>;
	entry?: Record<string, unknown>;
	omitFromEntry?: string;
} = {}) => {
	const testFileEntry: Record<string, unknown> = {
		testFilePath: '/repo/packages/engine/src/gates/runGates.unit.test.ts',
		assertionResults: [
			{
				title: 'runs every configured gate',
				ancestorTitles: ['runGates'],
				fullName: 'runGates > runs every configured gate',
				status: 'passed',
				durationMs: 12,
				...assertion,
			},
		],
		...entry,
	};

	if (omitFromEntry) {
		delete testFileEntry[omitFromEntry];
	}

	return { resultsFile: { testResults: [testFileEntry] } };
};

describe('TestResultsFile', () => {
	test('TestResultsFile: accepts an unrecognised status and refuses a malformed results entry', () => {
		const { resultsFile } = setupResultsFile({ assertion: { status: 'obliterated' } });

		const parsed = TestResultsFile.parse(resultsFile);

		// a status the engine does not know has to survive parsing verbatim: the
		// acceptance check reads it as "not passing", and a silently dropped file
		// would read as a test that never ran at all
		expect(parsed.testResults[0]?.assertionResults[0]).toStrictEqual({
			title: 'runs every configured gate',
			ancestorTitles: ['runGates'],
			fullName: 'runGates > runs every configured gate',
			status: 'obliterated',
			durationMs: 12,
		});
		// an assertion list that is not a list is malformed evidence, not an empty
		// one — reading it as empty would turn a broken reporter into a passing gate
		// with no cases
		expect(TestResultsFile.safeParse(setupResultsFile({ entry: { assertionResults: 'none' } }).resultsFile).success).toBe(false);
		expect(TestResultsFile.safeParse(setupResultsFile({ entry: { assertionResults: { title: 'runs every configured gate' } } }).resultsFile).success).toBe(
			false,
		);
		// and an entry naming no test file names nothing a row could be matched
		// against, so it is refused rather than carried
		expect(TestResultsFile.safeParse(setupResultsFile({ omitFromEntry: 'testFilePath' }).resultsFile).success).toBe(false);
		expect(TestResultsFile.safeParse(setupResultsFile({ entry: { testFilePath: '' } }).resultsFile).success).toBe(false);
	});
});
