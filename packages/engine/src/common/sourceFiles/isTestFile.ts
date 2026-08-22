/** A directory whose name says everything under it is test code. */
const testDirectory = /(^|\/)(tests?|__tests__|__mocks__|e2e)\//;

/**
 * The same, minus `test`/`tests`. Inside a standards pack those name a
 * document set — the standards about how to write tests — and the rule
 * implementations under one are ordinary source.
 */
const testDirectoryInStandardsPack = /(^|\/)(__tests__|__mocks__|e2e)\//;

/** A filename that says it is a test, wherever it sits. */
const testFileName = /\.(test|spec)\./;

interface Params {
	/** A repo-relative path. */
	path: string;
	/**
	 * Repo-relative roots of the standards packs in the tree, as
	 * `listSourceFiles` reports them. Only a path beneath one is judged by a
	 * pack's naming; everything else reads as an ordinary repo.
	 */
	standardsPacks?: string[];
}

/**
 * Whether a path is test code — by its filename, or by a test directory
 * anywhere above it.
 *
 * The answer buys exemptions: test files are excused from the duplication
 * tiers, because two tests asserting the same value are each stating what the
 * code should do rather than copying one another, and from one-export-per-file.
 * So a file wrongly called a test is not merely mis-sorted — it quietly stops
 * being held to those rules.
 *
 * That is why a standards pack is called out. A pack sorts its rules into two
 * sets, `code` and `tests`, and the second is a set name, not a directory of
 * tests: every `check.ts` beneath it is engine code the rules apply to. Its own
 * tests are still tests — they say so in their filenames.
 *
 * A deliberate mirror of the default standards pack's `isTestFile`, kept
 * identical because the two have to agree: the engine splits a file list into
 * `source` and `tests` with this copy, and the rules that count references
 * re-ask the same question with theirs. Neither copy can import the other — a
 * standards pack ships as a bare directory beside the engine, with no manifest
 * and no `node_modules`, so every value it imports has to resolve inside its
 * own tree, and the engine runs against whatever pack `standards-packs` names
 * rather than the default one. Change one, change the other.
 *
 * @mirrors packages/standards-typescript/common/paths/isTestFile.ts
 */
export const isTestFile = ({ path, standardsPacks = [] }: Params): boolean => {
	const inStandardsPack = standardsPacks.some((root) => path.startsWith(`${root}/`));
	const directory = inStandardsPack ? testDirectoryInStandardsPack : testDirectory;

	return directory.test(path) || testFileName.test(path);
};
