import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import type ts from 'typescript';
import { buildRawFinding } from './buildRawFinding.ts';

interface Params {
	/** The rule these findings answer for. */
	rule: string;
	/** The lines in one parsed file that violate the rule, in report order. */
	findLines: ({ sourceFile, compiler }: { sourceFile: ts.SourceFile; compiler: typeof ts }) => number[];
	/** The finding's detail, given the lines found — it names what sits on them. */
	detail: ({ lines }: { lines: number[] }) => string;
	guidance: string;
}

/**
 * A whole check for a rule that reads parsed files and reports by line.
 *
 * Every such rule does the same three things: narrow to the syntax-tree input,
 * ask each tree for its offending lines, and turn a non-empty answer into one
 * finding against that path. Only the question and the wording differ, so a
 * rule states those and this supplies the rest — including the module shape,
 * which is why two rules using it share no function body to drift apart.
 *
 * One finding per file, never one per line: the work is "open this file and
 * fix what it says", which does not become three jobs because three lines say
 * it.
 */
export const buildTreeLineCheck = ({ rule, findLines, detail, guidance }: Params): StandardsCheckModule => ({
	inputKind: 'syntax-tree',
	run: ({ input }): RawStandardsFinding[] => {
		if (input.kind !== 'syntax-tree') {
			return [];
		}

		const findings: RawStandardsFinding[] = [];

		for (const [path, tree] of input.trees) {
			const lines = findLines({ sourceFile: tree, compiler: input.compiler });

			if (lines.length > 0) {
				findings.push(buildRawFinding({ rule, files: [{ path }], detail: detail({ lines }), guidance }));
			}
		}

		return findings;
	},
});
