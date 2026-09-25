import { readGitCommittedFile } from '#src/common/git/readGitCommittedFile.ts';

interface Params {
	cwd: string;
	/** The ledger row's test file. */
	testFile: string;
	/** The plan's moves whose destination is a test file. */
	movePaths: { from: string; to: string }[];
}

/**
 * The committed content a ledger test file inherits: `HEAD` at the move's source
 * when the file is a move destination, `HEAD` at the file itself otherwise.
 *
 * A move destination does not exist at `HEAD`, so reading it directly would
 * answer "nothing committed" — and a test written for older behaviour could then
 * be named as a new criterion's verifier simply by moving its file. The cases
 * the destination will inherit are still at the source, so the source is what is
 * read.
 */
export const readCommittedTestSource = async ({ cwd, testFile, movePaths }: Params): Promise<string | undefined> => {
	const move = movePaths.find((entry) => entry.to === testFile);

	return readGitCommittedFile({ cwd, path: move?.from ?? testFile });
};
