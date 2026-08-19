import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { buildRawFinding } from './buildRawFinding.ts';
import { readTestFiles } from './readTestFiles.ts';

interface Params {
	/** The rule id these findings answer for. */
	rule: string;
	/** Which of the rule's resolved settings holds the limit it measures against. */
	setting: string;
	/** What one test file broke and the sites to report it against, or undefined when the file is within the limit. */
	report: ({ file, text, limit }: { file: string; text: string; limit: number }) => { files: RawStandardsFinding['files']; detail: string } | undefined;
	guidance: string;
}

/**
 * A whole check for a rule that measures a test file against a tunable numeric
 * limit.
 *
 * The measurement is the whole of what such rules disagree about: each reads
 * the same test files, resolves one number the repo may retune, and turns a
 * file over that number into a single finding. Stating the number's name and
 * the measurement leaves the surrounding half — the input kind, the read, the
 * walk, the finding — written once here instead of once per rule.
 */
export const buildTestLimitCheck = ({ rule, setting, report, guidance }: Params): StandardsCheckModule => ({
	inputKind: 'test-file',
	run: ({ input, settings }): RawStandardsFinding[] =>
		readTestFiles({ input }).flatMap(({ file, text }) => {
			const violation = report({ file, text, limit: settings[setting] });

			return violation === undefined ? [] : [buildRawFinding({ rule, files: violation.files, detail: violation.detail, guidance })];
		}),
});
