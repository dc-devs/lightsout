import { findTestTitles } from '#src/common/sourceFiles/findTestTitles.ts';
import { matchesTestTitle } from '#src/common/sourceFiles/matchesTestTitle.ts';

interface Params {
	/** The file's text. */
	content: string;
	/** The exact name a ledger row (or an acceptance-test record) carries. */
	testName: string;
}

/**
 * Whether a file states one particular test title.
 *
 * This is the static, cheap half of test identity — enough to refuse a plan
 * that names a test a file already carries, and enough to tell a ledger writer
 * that the case it was asked for is not there. The strong half is the runner's
 * own per-test result, which `checkAcceptanceTests` reads through the same
 * matcher, so a title the engine accepts in one place is accepted in both.
 */
export const holdsTestTitle = ({ content, testName }: Params): boolean => {
	return findTestTitles({ content }).some((title) => matchesTestTitle({ testName, title }));
};
