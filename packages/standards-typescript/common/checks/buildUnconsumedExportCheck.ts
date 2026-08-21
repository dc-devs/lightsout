import type { StandardsCheckModule } from '@lightsout/standards-contracts';
import { readFileTexts } from '../checkInput/readFileTexts.ts';
import { buildUnconsumedFindings } from '../findings/buildUnconsumedFindings.ts';
import type { UnconsumedExport } from '../types/UnconsumedExport.ts';

interface Params {
	/** The rule id claiming this verdict. */
	rule: string;
	/** Which unconsumed exports this rule claims — the verdicts are mutually exclusive, so each export lands in at most one rule. */
	matches: (reachedBy: UnconsumedExport['reachedBy']) => boolean;
	/** Completes the sentence "'a', 'b' are …" — e.g. `referenced nowhere else`. */
	detail: string;
	guidance: string;
}

/**
 * A whole check for a rule that reports on exports nothing consumes.
 *
 * `buildUnconsumedFindings` already holds the counting and the grouping. This
 * holds the rest of the check around it — the input it declares and the read
 * that gets there — so the three rules using it share a body instead of
 * repeating one. Each states only which verdict it claims and what it says.
 */
export const buildUnconsumedExportCheck = ({ rule, matches, detail, guidance }: Params): StandardsCheckModule => ({
	inputKind: 'file-text',
	run: ({ input }) => {
		const { files, contents, standardsPackages } = readFileTexts({ input });

		return buildUnconsumedFindings({ files, contents, standardsPackages, rule, matches, detail, guidance });
	},
});
