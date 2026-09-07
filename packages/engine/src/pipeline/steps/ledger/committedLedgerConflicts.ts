import { holdsTestTitle } from '#src/common/sourceFiles/holdsTestTitle.ts';
import { readCommittedTestSource } from '#src/pipeline/steps/ledger/readCommittedTestSource.ts';

interface Params {
	cwd: string;
	/** One entry per ledger test file: its repo-relative path and every test name the ledger assigns to it. */
	assignments: { testFile: string; testNames: string[] }[];
	/** The plan's moves whose destination is a test file. */
	movePaths: { from: string; to: string }[];
}

/**
 * Assigned names a file already carries AS COMMITTED — never the working tree,
 * so a re-entry after a park reads the same verdict as the first pass. A test
 * written for older behaviour cannot stand as a new criterion's verifier, and
 * this is what catches a plan that names one.
 *
 * @returns one line per offending file, empty when the ledger conflicts with nothing.
 */
export const committedLedgerConflicts = async ({ cwd, assignments, movePaths }: Params): Promise<string[]> => {
	const found = await Promise.all(
		assignments.map(async ({ testFile, testNames }) => {
			const content = await readCommittedTestSource({ cwd, testFile, movePaths });
			const names = content === undefined ? [] : testNames.filter((testName) => holdsTestTitle({ content, testName }));

			return { testFile, names };
		}),
	);

	return found.filter(({ names }) => names.length > 0).map(({ testFile, names }) => `${testFile}: ${names.join(', ')}`);
};
