import type { RawStandardsFinding } from '@lightsout/standards-contracts';
import { getUnconsumedExports } from '../modules/getUnconsumedExports.ts';
import type { UnconsumedExport } from '../types/UnconsumedExport.ts';
import { buildRawFinding } from './buildRawFinding.ts';

interface Params {
	/** Files in scope, from the file-text input. */
	files: string[];
	/** Text for every file in scope and every reference file. */
	contents: Map<string, string>;
	/** Repo-relative standards package roots, forwarded to the reference counting. */
	standardsPackages: string[];
	/** The rule id claiming this verdict. */
	rule: string;
	/** Which unconsumed exports this rule claims — the verdicts are mutually exclusive, so each export lands in at most one rule. */
	matches: (reachedBy: UnconsumedExport['reachedBy']) => boolean;
	/** Completes the sentence "'a', 'b' are …" — e.g. `referenced nowhere else`. */
	detail: string;
	guidance: string;
}

/**
 * The findings one verdict earns over a repo's unconsumed exports, with every
 * such export of a single file gathered into one finding that names each.
 *
 * Several rules read the same reference count and differ only in which verdict
 * they claim, so the counting, the grouping and the sentence shape live here
 * once: a rule states its verdict and the prose it reports under, nothing else.
 * Splitting them into rules rather than one is what lets a repo switch off the
 * verdict it disagrees with — a deliberate public API is not a defect — while
 * keeping the others.
 */
export const buildUnconsumedFindings = ({ files, contents, standardsPackages, rule, matches, detail, guidance }: Params): RawStandardsFinding[] => {
	const byFile = new Map<string, string[]>();

	for (const { file, name, reachedBy } of getUnconsumedExports({ files, contents, standardsPackages })) {
		if (matches(reachedBy)) {
			byFile.set(file, [...(byFile.get(file) ?? []), name]);
		}
	}

	return [...byFile].map(([file, names]) =>
		buildRawFinding({
			rule,
			files: [{ path: file }],
			detail: `${names.map((name) => `'${name}'`).join(', ')} ${names.length > 1 ? 'are' : 'is'} ${detail}`,
			guidance,
		}),
	);
};
