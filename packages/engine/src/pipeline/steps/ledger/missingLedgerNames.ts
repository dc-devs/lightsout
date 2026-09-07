import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { holdsTestTitle } from '#src/common/sourceFiles/holdsTestTitle.ts';

interface Params {
	cwd: string;
	/** Repo-relative path of the ledger test file. */
	testFile: string;
	/** Every test name the ledger assigns to it. */
	testNames: string[];
}

/**
 * Assigned names absent from the file on disk.
 *
 * @returns the missing names, or undefined when the file itself is absent — the writer reported complete and wrote nothing.
 */
export const missingLedgerNames = async ({ cwd, testFile, testNames }: Params): Promise<string[] | undefined> => {
	const content = await readFile(join(cwd, testFile), 'utf8').catch(() => undefined);

	return content === undefined ? undefined : testNames.filter((testName) => !holdsTestTitle({ content, testName }));
};
