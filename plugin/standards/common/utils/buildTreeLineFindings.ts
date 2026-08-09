import type ts from 'typescript';
import type { RawStandardsFinding, SyntaxTreeInput } from '@/contracts';
import { buildRawFinding } from './buildRawFinding.ts';

interface Params {
	input: SyntaxTreeInput;
	/** The rule these findings answer for. */
	rule: string;
	/** The lines in one parsed file that violate the rule, in report order. */
	findLines: ({ sourceFile, compiler }: { sourceFile: ts.SourceFile; compiler: typeof ts }) => number[];
	/** The finding's detail, given the lines found — it names what sits on them. */
	detail: ({ lines }: { lines: number[] }) => string;
	guidance: string;
}

/**
 * One finding per parsed file that has offending lines, none for the files that
 * do not.
 *
 * The walk is the same for every rule that reads syntax trees and reports by
 * line: ask each tree for its bad lines, and turn a non-empty answer into a
 * finding against that path. Only the question and the wording differ, so a
 * rule supplies those and nothing else.
 */
export const buildTreeLineFindings = ({ input, rule, findLines, detail, guidance }: Params): RawStandardsFinding[] => {
	const findings: RawStandardsFinding[] = [];

	for (const [path, tree] of input.trees) {
		const lines = findLines({ sourceFile: tree, compiler: input.compiler });

		if (lines.length > 0) {
			findings.push(buildRawFinding({ rule, files: [{ path }], detail: detail({ lines }), guidance }));
		}
	}

	return findings;
};
